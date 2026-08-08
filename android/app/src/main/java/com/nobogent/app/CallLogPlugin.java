package com.nobogent.app;

import android.Manifest;
import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CallLog;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileInputStream;

@CapacitorPlugin(
    name = "CallLog",
    permissions = {
        @Permission(
            alias = "callLog",
            strings = {
                Manifest.permission.READ_CALL_LOG,
                Manifest.permission.READ_PHONE_STATE,
                Manifest.permission.READ_EXTERNAL_STORAGE
            }
        )
    }
)
public class CallLogPlugin extends Plugin {

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (hasRequiredPermissions()) {
            JSObject ret = new JSObject();
            ret.put("hasPermission", true);
            call.resolve(ret);
        } else {
            requestPermissionForAlias("callLog", call, "permissionCallback");
        }
    }

    @PluginMethod
    public void hasPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("hasPermission", hasRequiredPermissions());
        call.resolve(ret);
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("hasPermission", hasRequiredPermissions());
        call.resolve(ret);
    }

    @PluginMethod
    public void getCallLog(PluginCall call) {
        if (!hasRequiredPermissions()) {
            requestPermissionForAlias("callLog", call, "getCallLogCallback");
            return;
        }
        readCallLogs(call);
    }

    @PermissionCallback
    private void getCallLogCallback(PluginCall call) {
        if (hasRequiredPermissions()) {
            readCallLogs(call);
        } else {
            call.reject("Permission to read call logs was denied.");
        }
    }

    private void readCallLogs(PluginCall call) {
        int limit = call.getInt("limit", 50);
        JSArray callLogArray = new JSArray();

        try {
            ContentResolver cr = getContext().getContentResolver();
            Uri callUri = CallLog.Calls.CONTENT_URI;
            String[] projection = new String[] {
                CallLog.Calls.NUMBER,
                CallLog.Calls.TYPE,
                CallLog.Calls.DURATION,
                CallLog.Calls.DATE,
                CallLog.Calls.CACHED_NAME
            };

            Cursor cursor = cr.query(
                callUri,
                projection,
                null,
                null,
                CallLog.Calls.DATE + " DESC"
            );

            if (cursor != null) {
                int count = 0;
                while (cursor.moveToNext() && count < limit) {
                    String number = cursor.getString(cursor.getColumnIndexOrThrow(CallLog.Calls.NUMBER));
                    int type = cursor.getInt(cursor.getColumnIndexOrThrow(CallLog.Calls.TYPE));
                    long duration = cursor.getLong(cursor.getColumnIndexOrThrow(CallLog.Calls.DURATION));
                    long date = cursor.getLong(cursor.getColumnIndexOrThrow(CallLog.Calls.DATE));
                    String name = cursor.getString(cursor.getColumnIndexOrThrow(CallLog.Calls.CACHED_NAME));

                    JSObject log = new JSObject();
                    log.put("number", number != null ? number : "");
                    log.put("type", type);
                    log.put("duration", duration);
                    log.put("date", date);
                    log.put("name", name != null ? name : "");

                    // Automatically scan device storage for matching call recording file
                    if (number != null && duration > 0) {
                        String recordingBase64 = findMatchingAudioRecording(cr, number, date);
                        if (recordingBase64 != null) {
                            log.put("recordingBase64", recordingBase64);
                        }
                    }

                    callLogArray.put(log);
                    count++;
                }
                cursor.close();
            }

            JSObject result = new JSObject();
            result.put("callLog", callLogArray);
            call.resolve(result);

        } catch (Exception e) {
            call.reject("Failed to query call logs: " + e.getMessage(), e);
        }
    }

    private String findMatchingAudioRecording(ContentResolver cr, String rawNumber, long callDate) {
        if (rawNumber == null || rawNumber.length() < 7) return null;
        String digitsOnly = rawNumber.replaceAll("[^0-9]", "");
        if (digitsOnly.length() < 7) return null;
        String last10 = digitsOnly.length() >= 10 ? digitsOnly.substring(digitsOnly.length() - 10) : digitsOnly;

        Uri audioUri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
        String[] projection = new String[] {
            MediaStore.Audio.Media.DATA,
            MediaStore.Audio.Media.DISPLAY_NAME,
            MediaStore.Audio.Media.DATE_ADDED,
            MediaStore.Audio.Media.SIZE
        };

        // Window: 5 minutes before call date to 10 minutes after
        long windowStartSec = (callDate / 1000) - 300;
        long windowEndSec = (callDate / 1000) + 600;

        String selection = MediaStore.Audio.Media.DATE_ADDED + " >= ? AND " + MediaStore.Audio.Media.DATE_ADDED + " <= ?";
        String[] selectionArgs = new String[] { String.valueOf(windowStartSec), String.valueOf(windowEndSec) };

        Cursor cursor = null;
        try {
            cursor = cr.query(audioUri, projection, selection, selectionArgs, MediaStore.Audio.Media.DATE_ADDED + " DESC");
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    String filePath = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATA));
                    String fileName = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME));
                    long fileSize = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE));

                    if (fileSize <= 0 || fileSize > 25 * 1024 * 1024) continue; // max 25MB

                    boolean isCallRecFolder = filePath != null && (
                        filePath.toLowerCase().contains("record") ||
                        filePath.toLowerCase().contains("call") ||
                        filePath.toLowerCase().contains("sound_recorder")
                    );

                    boolean containsNumber = (fileName != null && fileName.contains(last10)) ||
                                             (filePath != null && filePath.contains(last10));

                    if (containsNumber || isCallRecFolder) {
                        File audioFile = new File(filePath);
                        if (audioFile.exists() && audioFile.canRead()) {
                            byte[] bytes = readFileToByteArray(audioFile);
                            if (bytes != null && bytes.length > 0) {
                                String ext = (fileName != null && fileName.contains(".")) 
                                    ? fileName.substring(fileName.lastIndexOf(".") + 1) 
                                    : "m4a";
                                String mime = "audio/" + ext;
                                cursor.close();
                                return "data:" + mime + ";base64," + Base64.encodeToString(bytes, Base64.NO_WRAP);
                            }
                        }
                    }
                }
            }
        } catch (Exception e) {
            // Ignore error
        } finally {
            if (cursor != null) cursor.close();
        }
        return null;
    }

    private byte[] readFileToByteArray(File file) {
        FileInputStream fis = null;
        try {
            byte[] data = new byte[(int) file.length()];
            fis = new FileInputStream(file);
            int bytesRead = 0;
            while (bytesRead < data.length) {
                int read = fis.read(data, bytesRead, data.length - bytesRead);
                if (read == -1) break;
                bytesRead += read;
            }
            return data;
        } catch (Exception e) {
            return null;
        } finally {
            if (fis != null) {
                try { fis.close(); } catch (Exception e) {}
            }
        }
    }
}

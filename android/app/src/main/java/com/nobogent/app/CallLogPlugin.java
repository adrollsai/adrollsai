package com.nobogent.app;

import android.Manifest;
import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.CallLog;
import android.provider.MediaStore;
import android.util.Log;
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
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(
    name = "CallLog",
    permissions = {
        @Permission(
            alias = "callLog",
            strings = { Manifest.permission.READ_CALL_LOG, Manifest.permission.READ_PHONE_STATE }
        ),
        @Permission(
            alias = "audio",
            strings = { Manifest.permission.READ_MEDIA_AUDIO }
        ),
        @Permission(
            alias = "storage",
            strings = { Manifest.permission.READ_EXTERNAL_STORAGE }
        )
    }
)
public class CallLogPlugin extends Plugin {

    private static final String TAG = "CallLogPlugin";

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (hasRequiredPermissions()) {
            JSObject ret = new JSObject();
            ret.put("hasPermission", true);
            call.resolve(ret);
        } else {
            // Request all permission aliases
            requestAllPermissions(call, "permissionCallback");
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

    @Override
    protected boolean hasRequiredPermissions() {
        boolean hasCallLog = getPermissionState("callLog") == com.getcapacitor.PermissionState.GRANTED;
        boolean hasMedia;
        if (Build.VERSION.SDK_INT >= 33) {
            hasMedia = getPermissionState("audio") == com.getcapacitor.PermissionState.GRANTED;
        } else {
            hasMedia = getPermissionState("storage") == com.getcapacitor.PermissionState.GRANTED;
        }
        return hasCallLog && hasMedia;
    }

    @PluginMethod
    public void getCallLog(PluginCall call) {
        if (!hasRequiredPermissions()) {
            requestAllPermissions(call, "getCallLogCallback");
            return;
        }
        readCallLogs(call);
    }

    @PermissionCallback
    private void getCallLogCallback(PluginCall call) {
        if (getPermissionState("callLog") == com.getcapacitor.PermissionState.GRANTED) {
            readCallLogs(call);
        } else {
            call.reject("Permission to read call logs was denied.");
        }
    }

    /**
     * Find the recording file for a specific call and upload it directly to the server.
     * This avoids sending large base64 data through the JS bridge.
     */
    @PluginMethod
    public void uploadCallRecording(PluginCall call) {
        String phoneNumber = call.getString("phoneNumber", "");
        long callDate = call.getLong("callDate", 0L);
        String uploadUrl = call.getString("uploadUrl", "");
        String authToken = call.getString("authToken", "");

        if (phoneNumber.isEmpty() || callDate == 0 || uploadUrl.isEmpty()) {
            call.reject("phoneNumber, callDate, and uploadUrl are required");
            return;
        }

        new Thread(() -> {
            try {
                File recordingFile = findRecordingFile(phoneNumber, callDate);
                if (recordingFile == null) {
                    JSObject result = new JSObject();
                    result.put("found", false);
                    result.put("message", "No recording file found for " + phoneNumber);
                    call.resolve(result);
                    return;
                }

                Log.d(TAG, "Found recording: " + recordingFile.getAbsolutePath() + " (" + recordingFile.length() + " bytes)");

                // Upload the file directly via multipart HTTP POST
                String recordingUrl = uploadFileToServer(recordingFile, uploadUrl, authToken, phoneNumber);

                JSObject result = new JSObject();
                result.put("found", true);
                result.put("filePath", recordingFile.getAbsolutePath());
                result.put("fileSize", recordingFile.length());
                result.put("recordingUrl", recordingUrl);
                call.resolve(result);

            } catch (Exception e) {
                Log.e(TAG, "uploadCallRecording failed", e);
                call.reject("Upload failed: " + e.getMessage(), e);
            }
        }).start();
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

                    // Check if a recording file exists for this call (just flag it, don't load content)
                    if (number != null && duration > 0) {
                        File recFile = findRecordingFile(number, date);
                        if (recFile != null) {
                            log.put("hasRecording", true);
                            log.put("recordingFilePath", recFile.getAbsolutePath());
                            log.put("recordingFileSize", recFile.length());
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

    /**
     * Find a recording file matching a phone call by scanning:
     * 1. Known manufacturer recording directories on the filesystem
     * 2. MediaStore audio index as fallback
     */
    private File findRecordingFile(String rawNumber, long callDateMs) {
        if (rawNumber == null || rawNumber.length() < 4) return null;

        String digitsOnly = rawNumber.replaceAll("[^0-9]", "");
        if (digitsOnly.length() < 4) return null;

        // Get last 10 and last 7 digits for flexible matching
        String last10 = digitsOnly.length() >= 10 ? digitsOnly.substring(digitsOnly.length() - 10) : digitsOnly;
        String last7 = digitsOnly.length() >= 7 ? digitsOnly.substring(digitsOnly.length() - 7) : digitsOnly;

        // Time window: 2 minutes before call to 10 minutes after (in milliseconds)
        long windowStartMs = callDateMs - (2 * 60 * 1000);
        long windowEndMs = callDateMs + (10 * 60 * 1000);

        // 1. Direct filesystem scan of known recording directories
        File sdcard = Environment.getExternalStorageDirectory();
        String[] knownPaths = {
            "Recordings/Call",
            "Recordings",
            "CallRecord",
            "MIUI/sound_recorder/call_rec",
            "Record/Call",
            "call_record",
            "PhoneRecord",
            "Recording/Call",
            "Sounds/CallRecord",
            "Music/Recordings/Call Recordings",
            "Call Recordings"
        };

        File bestMatch = null;
        long bestMatchTimeDiff = Long.MAX_VALUE;

        for (String path : knownPaths) {
            File dir = new File(sdcard, path);
            if (!dir.exists() || !dir.isDirectory()) continue;

            File[] files = dir.listFiles();
            if (files == null) continue;

            for (File f : files) {
                if (!f.isFile()) continue;
                String fname = f.getName().toLowerCase();

                // Must be an audio file
                if (!fname.endsWith(".m4a") && !fname.endsWith(".mp3") && !fname.endsWith(".amr") &&
                    !fname.endsWith(".wav") && !fname.endsWith(".aac") && !fname.endsWith(".ogg") &&
                    !fname.endsWith(".3gp")) continue;

                // File modification time must be within our window
                long fileTime = f.lastModified();
                if (fileTime < windowStartMs || fileTime > windowEndMs) continue;

                // Check if filename contains the phone number (last 10 or last 7 digits)
                boolean numberMatch = fname.contains(last10) || fname.contains(last7);

                // If the phone number isn't in filename, still accept if it's in a call recording
                // folder AND the timestamp matches closely (within 2 minutes of call)
                long timeDiff = Math.abs(fileTime - callDateMs);
                if (numberMatch) {
                    if (timeDiff < bestMatchTimeDiff) {
                        bestMatch = f;
                        bestMatchTimeDiff = timeDiff;
                    }
                } else if (timeDiff < 120000) { // Within 2 minutes - likely the right recording
                    if (bestMatch == null || timeDiff < bestMatchTimeDiff) {
                        bestMatch = f;
                        bestMatchTimeDiff = timeDiff;
                    }
                }
            }
        }

        if (bestMatch != null) {
            Log.d(TAG, "Found recording via filesystem scan: " + bestMatch.getAbsolutePath());
            return bestMatch;
        }

        // 2. Fallback: MediaStore query
        try {
            ContentResolver cr = getContext().getContentResolver();
            Uri audioUri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
            String[] projection = {
                MediaStore.Audio.Media.DATA,
                MediaStore.Audio.Media.DISPLAY_NAME,
                MediaStore.Audio.Media.DATE_MODIFIED,
                MediaStore.Audio.Media.SIZE
            };

            long windowStartSec = windowStartMs / 1000;
            long windowEndSec = windowEndMs / 1000;

            String selection = MediaStore.Audio.Media.DATE_MODIFIED + " >= ? AND " +
                               MediaStore.Audio.Media.DATE_MODIFIED + " <= ?";
            String[] selectionArgs = { String.valueOf(windowStartSec), String.valueOf(windowEndSec) };

            Cursor cursor = cr.query(audioUri, projection, selection, selectionArgs,
                MediaStore.Audio.Media.DATE_MODIFIED + " DESC");

            if (cursor != null) {
                while (cursor.moveToNext()) {
                    String filePath = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATA));
                    String fileName = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME));
                    long fileSize = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE));

                    if (fileSize <= 0 || fileSize > 50 * 1024 * 1024) continue;
                    if (filePath == null) continue;

                    String lowerPath = filePath.toLowerCase();
                    boolean isCallRecFolder = lowerPath.contains("record") || lowerPath.contains("call");
                    boolean containsNumber = (fileName != null && (fileName.contains(last10) || fileName.contains(last7)));

                    if (containsNumber || isCallRecFolder) {
                        File audioFile = new File(filePath);
                        if (audioFile.exists() && audioFile.canRead()) {
                            cursor.close();
                            Log.d(TAG, "Found recording via MediaStore: " + filePath);
                            return audioFile;
                        }
                    }
                }
                cursor.close();
            }
        } catch (Exception e) {
            Log.w(TAG, "MediaStore query failed", e);
        }

        return null;
    }

    /**
     * Upload a file to the server using multipart/form-data HTTP POST.
     * Returns the public URL of the uploaded recording.
     */
    private String uploadFileToServer(File file, String uploadUrl, String authToken, String phoneNumber) throws Exception {
        String boundary = "----NobogentBoundary" + System.currentTimeMillis();
        URL url = new URL(uploadUrl);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
        if (authToken != null && !authToken.isEmpty()) {
            conn.setRequestProperty("Cookie", "sb-access-token=" + authToken);
            conn.setRequestProperty("Authorization", "Bearer " + authToken);
        }
        conn.setConnectTimeout(30000);
        conn.setReadTimeout(60000);

        OutputStream os = conn.getOutputStream();

        // Write phone number field
        writeMultipartField(os, boundary, "phoneNumber", phoneNumber);

        // Write the file
        String fileName = file.getName();
        String mimeType = "audio/mp4"; // default
        if (fileName.endsWith(".mp3")) mimeType = "audio/mpeg";
        else if (fileName.endsWith(".amr")) mimeType = "audio/amr";
        else if (fileName.endsWith(".wav")) mimeType = "audio/wav";
        else if (fileName.endsWith(".ogg")) mimeType = "audio/ogg";
        else if (fileName.endsWith(".aac")) mimeType = "audio/aac";

        String fileHeader = "--" + boundary + "\r\n" +
            "Content-Disposition: form-data; name=\"file\"; filename=\"" + fileName + "\"\r\n" +
            "Content-Type: " + mimeType + "\r\n\r\n";
        os.write(fileHeader.getBytes("UTF-8"));

        FileInputStream fis = new FileInputStream(file);
        byte[] buffer = new byte[8192];
        int bytesRead;
        while ((bytesRead = fis.read(buffer)) != -1) {
            os.write(buffer, 0, bytesRead);
        }
        fis.close();

        os.write(("\r\n--" + boundary + "--\r\n").getBytes("UTF-8"));
        os.flush();
        os.close();

        int responseCode = conn.getResponseCode();
        if (responseCode == 200 || responseCode == 201) {
            java.io.InputStream is = conn.getInputStream();
            byte[] respBytes = new byte[4096];
            int len = is.read(respBytes);
            is.close();
            if (len > 0) {
                String respStr = new String(respBytes, 0, len, "UTF-8");
                // Parse JSON response to get recording URL
                // Simple extraction without JSON library
                int idx = respStr.indexOf("\"recordingUrl\"");
                if (idx >= 0) {
                    int start = respStr.indexOf("\"", idx + 14) + 1;
                    int end = respStr.indexOf("\"", start);
                    if (start > 0 && end > start) {
                        return respStr.substring(start, end);
                    }
                }
            }
            return "";
        } else {
            java.io.InputStream es = conn.getErrorStream();
            if (es != null) {
                byte[] errBytes = new byte[2048];
                int len = es.read(errBytes);
                es.close();
                String errStr = len > 0 ? new String(errBytes, 0, len, "UTF-8") : "Unknown error";
                Log.e(TAG, "Upload error " + responseCode + ": " + errStr);
            }
            throw new Exception("Upload failed with HTTP " + responseCode);
        }
    }

    private void writeMultipartField(OutputStream os, String boundary, String name, String value) throws Exception {
        String field = "--" + boundary + "\r\n" +
            "Content-Disposition: form-data; name=\"" + name + "\"\r\n\r\n" +
            value + "\r\n";
        os.write(field.getBytes("UTF-8"));
    }
}

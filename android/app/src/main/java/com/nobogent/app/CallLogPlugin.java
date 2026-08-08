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
    public boolean hasRequiredPermissions() {
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

    @PluginMethod
    public void debugScanRecordings(PluginCall call) {
        JSObject result = new JSObject();
        result.put("sdkVersion", Build.VERSION.SDK_INT);
        result.put("hasCallLogPermission", getPermissionState("callLog") == com.getcapacitor.PermissionState.GRANTED);
        
        boolean hasMediaPerm = Build.VERSION.SDK_INT >= 33
            ? getPermissionState("audio") == com.getcapacitor.PermissionState.GRANTED
            : getPermissionState("storage") == com.getcapacitor.PermissionState.GRANTED;
        result.put("hasAudioPermission", hasMediaPerm);

        JSArray samples = new JSArray();
        int totalAudioCount = 0;

        try {
            ContentResolver cr = getContext().getContentResolver();
            Uri audioUri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
            String[] projection = {
                MediaStore.Audio.Media.DATA,
                MediaStore.Audio.Media.DISPLAY_NAME,
                MediaStore.Audio.Media.SIZE
            };

            Cursor cursor = cr.query(audioUri, projection, null, null, MediaStore.Audio.Media.DATE_MODIFIED + " DESC");
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    totalAudioCount++;
                    if (samples.length() < 20) {
                        String path = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATA));
                        String name = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME));
                        samples.put(name + " -> " + path);
                    }
                }
                cursor.close();
            }
        } catch (Exception e) {
            result.put("error", e.getMessage());
        }

        result.put("totalAudioCount", totalAudioCount);
        result.put("sampleFiles", samples);
        call.resolve(result);
    }

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

    private File findRecordingFile(String rawNumber, long callDateMs) {
        if (rawNumber == null || rawNumber.length() < 4) return null;

        String digitsOnly = rawNumber.replaceAll("[^0-9]", "");
        if (digitsOnly.length() < 4) return null;

        String last10 = digitsOnly.length() >= 10 ? digitsOnly.substring(digitsOnly.length() - 10) : digitsOnly;
        String last7 = digitsOnly.length() >= 7 ? digitsOnly.substring(digitsOnly.length() - 7) : digitsOnly;

        long windowStartMs = callDateMs - (10 * 60 * 1000);
        long windowEndMs = callDateMs + (30 * 60 * 1000);

        try {
            ContentResolver cr = getContext().getContentResolver();
            Uri audioUri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
            String[] projection = {
                MediaStore.Audio.Media.DATA,
                MediaStore.Audio.Media.DISPLAY_NAME,
                MediaStore.Audio.Media.DATE_MODIFIED,
                MediaStore.Audio.Media.SIZE
            };

            Cursor cursor = cr.query(audioUri, projection, null, null, MediaStore.Audio.Media.DATE_MODIFIED + " DESC");

            if (cursor != null) {
                File bestNumberMatch = null;
                long closestTimeDiff = Long.MAX_VALUE;

                File bestTimeMatchInCallDir = null;
                long closestCallDirTimeDiff = Long.MAX_VALUE;

                while (cursor.moveToNext()) {
                    String filePath = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATA));
                    String fileName = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME));
                    long fileSize = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE));

                    if (fileSize <= 0 || fileSize > 100 * 1024 * 1024) continue;
                    if (filePath == null) continue;

                    String lowerPath = filePath.toLowerCase();
                    String lowerName = fileName != null ? fileName.toLowerCase() : "";

                    if (!lowerName.endsWith(".m4a") && !lowerName.endsWith(".mp3") && !lowerName.endsWith(".amr") &&
                        !lowerName.endsWith(".wav") && !lowerName.endsWith(".aac") && !lowerName.endsWith(".ogg") &&
                        !lowerName.endsWith(".3gp") && !lowerPath.endsWith(".m4a") && !lowerPath.endsWith(".mp3")) continue;

                    long dateModifiedMs = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_MODIFIED)) * 1000L;
                    if (dateModifiedMs <= 0) {
                        File tmpFile = new File(filePath);
                        if (tmpFile.exists()) dateModifiedMs = tmpFile.lastModified();
                    }

                    boolean containsNumber = lowerName.contains(last10) || lowerPath.contains(last10) ||
                                             lowerName.contains(last7) || lowerPath.contains(last7);

                    boolean isCallRecFolder = lowerPath.contains("record") || lowerPath.contains("call") || lowerPath.contains("sound");

                    long timeDiff = Math.abs(dateModifiedMs - callDateMs);

                    if (containsNumber) {
                        if (timeDiff < closestTimeDiff) {
                            File f = new File(filePath);
                            if (f.exists() && f.canRead()) {
                                bestNumberMatch = f;
                                closestTimeDiff = timeDiff;
                            }
                        }
                    } else if (isCallRecFolder && dateModifiedMs >= windowStartMs && dateModifiedMs <= windowEndMs) {
                        if (timeDiff < closestCallDirTimeDiff) {
                            File f = new File(filePath);
                            if (f.exists() && f.canRead()) {
                                bestTimeMatchInCallDir = f;
                                closestCallDirTimeDiff = timeDiff;
                            }
                        }
                    }
                }
                cursor.close();

                if (bestNumberMatch != null) {
                    Log.d(TAG, "Found recording via MediaStore number match: " + bestNumberMatch.getAbsolutePath());
                    return bestNumberMatch;
                }

                if (bestTimeMatchInCallDir != null) {
                    Log.d(TAG, "Found recording via MediaStore call folder time match: " + bestTimeMatchInCallDir.getAbsolutePath());
                    return bestTimeMatchInCallDir;
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "MediaStore query error", e);
        }

        try {
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
                "Call Recordings",
                "Android/data/com.android.phone/files",
                "VoiceRecorder",
                "Sounds"
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

                    if (!fname.endsWith(".m4a") && !fname.endsWith(".mp3") && !fname.endsWith(".amr") &&
                        !fname.endsWith(".wav") && !fname.endsWith(".aac") && !fname.endsWith(".ogg") &&
                        !fname.endsWith(".3gp")) continue;

                    long fileTime = f.lastModified();
                    long timeDiff = Math.abs(fileTime - callDateMs);

                    boolean numberMatch = fname.contains(last10) || fname.contains(last7);

                    if (numberMatch) {
                        if (timeDiff < bestMatchTimeDiff) {
                            bestMatch = f;
                            bestMatchTimeDiff = timeDiff;
                        }
                    } else if (fileTime >= windowStartMs && fileTime <= windowEndMs) {
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
        } catch (Exception e) {
            Log.w(TAG, "Filesystem scan error", e);
        }

        return null;
    }

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
        writeMultipartField(os, boundary, "phoneNumber", phoneNumber);

        String fileName = file.getName();
        String mimeType = "audio/mp4";
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

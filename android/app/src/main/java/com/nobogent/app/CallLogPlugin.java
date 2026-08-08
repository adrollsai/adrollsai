package com.nobogent.app;

import android.Manifest;
import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CallLog;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "CallLog",
    permissions = {
        @Permission(
            alias = "callLog",
            strings = { Manifest.permission.READ_CALL_LOG, Manifest.permission.READ_PHONE_STATE }
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
                CallLog.Calls.DATE + " DESC LIMIT " + limit
            );

            if (cursor != null) {
                while (cursor.moveToNext()) {
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

                    callLogArray.put(log);
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
}

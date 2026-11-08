package com.jeiel85.lumenhollow;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * 기록 파일 내보내기(설정 → 기록 → 내보내기, #49).
 * 안드로이드 WebView는 blob 다운로드와 Web Share(파일)를 지원하지 않아, 시스템 '저장' 창(ACTION_CREATE_DOCUMENT)으로
 * 사용자가 고른 곳에 글을 쓴다. 저장소 권한이 필요 없다. 결과: { saved: true } 또는 취소 시 { saved: false }.
 */
@CapacitorPlugin(name = "FileSave")
public class FileSavePlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        String name = call.getString("name");
        String text = call.getString("text");
        if (name == null || name.isEmpty() || text == null) {
            call.reject("name과 text가 필요합니다.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mime", "application/json"));
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "onSaveResult");
    }

    @ActivityCallback
    private void onSaveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        JSObject ret = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            ret.put("saved", false);
            call.resolve(ret);
            return;
        }
        try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "w")) {
            if (out == null) throw new IOException("저장할 파일을 열지 못했습니다.");
            out.write(call.getString("text", "").getBytes(StandardCharsets.UTF_8));
            ret.put("saved", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("파일을 쓰지 못했습니다: " + e.getMessage(), e);
        }
    }
}

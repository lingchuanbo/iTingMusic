package com.zenplayer.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.zenplayer.app.exoplayer.ExoPlayerPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundModePlugin.class);
        registerPlugin(ExoPlayerPlugin.class);
        super.onCreate(savedInstanceState);
        
        // 允许混合内容（HTTPS 页面加载 HTTP 音乐资源）
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
    }
}

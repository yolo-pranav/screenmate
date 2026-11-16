package com.yolopranav.screenmate;

import android.app.Dialog;
import android.content.pm.ActivityInfo;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge is created in super.onCreate.
        registerPlugin(ApkUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
        bridge.getWebView().setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("http://localhost") || url.startsWith("https://localhost")) {
                    return super.shouldOverrideUrlLoading(view, request);
                }
                // Block all external URLs, deep links, intent://, market://, etc.
                return true;
            }
        });

        // Video fullscreen: show the video in a fullscreen window (system bars hidden,
        // notch area used) instead of Capacitor's default, which keeps it inside the app.
        bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(bridge) {
            private Dialog fullscreen;

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                fullscreen = new Dialog(MainActivity.this, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
                fullscreen.setContentView(view);
                fullscreen.setOnDismissListener(d -> {
                    callback.onCustomViewHidden();
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                });
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    fullscreen.getWindow().getAttributes().layoutInDisplayCutoutMode =
                        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                }
                fullscreen.show();
                WindowCompat.getInsetsController(fullscreen.getWindow(), view).hide(WindowInsetsCompat.Type.systemBars());
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            }

            @Override
            public void onHideCustomView() {
                if (fullscreen != null) fullscreen.dismiss();
                fullscreen = null;
            }
        });
    }
}

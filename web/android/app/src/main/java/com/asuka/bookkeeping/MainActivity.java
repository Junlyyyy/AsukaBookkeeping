package com.asuka.bookkeeping;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.Window;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AsukaCapturePlugin.class);
        registerPlugin(AsukaAsrProxyPlugin.class);
        super.onCreate(savedInstanceState);
        setupAsukaStatusBar();
    }

    /** 状态栏透明（透出 App 浅色背景）+ 深色图标（黑色）：浅色界面上图标清晰可见 */
    private void setupAsukaStatusBar() {
        Window w = getWindow();
        w.setStatusBarColor(Color.TRANSPARENT);
        View decor = w.getDecorView();
        int vis = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR; // 黑色图标（浅色背景）
        decor.setSystemUiVisibility(vis);
    }
}

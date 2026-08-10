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

    /** 状态栏透明 + 浅色图标（白色）：顶部明日香红橙渐变透到状态栏后，白图标可见 */
    private void setupAsukaStatusBar() {
        Window w = getWindow();
        w.setStatusBarColor(Color.TRANSPARENT);
        View decor = w.getDecorView();
        int vis = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN;
        // 不设置 SYSTEM_UI_FLAG_LIGHT_STATUS_BAR → 图标保持浅色（白色）
        decor.setSystemUiVisibility(vis);
    }
}

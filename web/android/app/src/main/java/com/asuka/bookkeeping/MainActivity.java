package com.asuka.bookkeeping;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AsukaCapturePlugin.class);
        super.onCreate(savedInstanceState);
    }
}

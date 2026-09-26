package io.github.theoneechoz.tankobon;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TankobonPlugin.class);
        super.onCreate(savedInstanceState);
        // a file shared with the app or opened with it
        if (savedInstanceState == null) TankobonPlugin.receive(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        TankobonPlugin.receive(intent);
    }
}

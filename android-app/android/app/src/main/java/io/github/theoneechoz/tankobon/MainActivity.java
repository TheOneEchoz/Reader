package io.github.theoneechoz.tankobon;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TankobonPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

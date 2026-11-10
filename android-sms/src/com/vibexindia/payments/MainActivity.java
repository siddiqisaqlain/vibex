package com.vibexindia.payments;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.format.DateUtils;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** One screen: is it working, allow SMS, send a test. Nothing to type. */
public class MainActivity extends Activity {
  private TextView status, detail, test;
  private Button allow, settings;
  private boolean askedOnce;

  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    int pad = dp(24);
    LinearLayout col = new LinearLayout(this);
    col.setOrientation(LinearLayout.VERTICAL);
    col.setPadding(pad, dp(48), pad, pad);
    col.setBackgroundColor(Color.WHITE);

    TextView title = text("Vibe X Payments", 26, true, Color.BLACK);
    col.addView(title);
    col.addView(text("Confirms website orders by itself when the money reaches your bank.", 15, false, Color.DKGRAY), gap(8));

    status = text("", 20, true, Color.BLACK);
    col.addView(status, gap(32));
    detail = text("", 15, false, Color.DKGRAY);
    col.addView(detail, gap(8));

    allow = button("Allow SMS");
    allow.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { askPermission(); } });
    col.addView(allow, gap(24));

    settings = button("Open app settings");
    settings.setOnClickListener(new View.OnClickListener() { public void onClick(View v) {
      startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
    } });
    col.addView(settings, gap(12));

    Button send = button("Send a test");
    send.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { sendTest(); } });
    col.addView(send, gap(32));
    test = text("", 15, false, Color.DKGRAY);
    col.addView(test, gap(8));

    col.addView(text("Only bank messages about money received are sent. Messages from people never leave this phone. "
        + "Keep this app installed; you don't need to open it.", 13, false, Color.GRAY), gap(40));

    ScrollView sv = new ScrollView(this);
    sv.setBackgroundColor(Color.WHITE);
    sv.addView(col);
    setContentView(sv);
  }

  @Override protected void onResume() {
    super.onResume();
    refresh();
    if (Queue.size(this) > 0) SendJob.schedule(this);
  }

  private boolean granted() {
    return Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED;
  }

  private void askPermission() {
    askedOnce = true;
    if (Build.VERSION.SDK_INT >= 23) requestPermissions(new String[] { Manifest.permission.RECEIVE_SMS }, 1);
  }

  @Override public void onRequestPermissionsResult(int code, String[] p, int[] r) { refresh(); }

  private void refresh() {
    boolean ok = granted();
    allow.setVisibility(ok ? View.GONE : View.VISIBLE);
    settings.setVisibility(!ok && askedOnce ? View.VISIBLE : View.GONE);
    if (!ok) {
      status.setText("⚠️ Not working yet: allow SMS");
      status.setTextColor(Color.rgb(176, 96, 0));
      detail.setText(askedOnce
          ? "If Android didn't ask, or says \"restricted setting\": tap Open app settings, then the ⋮ menu at the top right, "
            + "then Allow restricted settings. Come back here and tap Allow SMS again."
          : "Tap Allow SMS, then Allow.");
      return;
    }
    status.setText("✅ Working");
    status.setTextColor(Color.rgb(0, 130, 60));
    StringBuilder d = new StringBuilder("Bank SMS go to the website automatically. You can close this app.");
    long okAt = Queue.lastOk(this), failAt = Queue.lastFail(this);
    if (okAt > 0) d.append("\n\nLast sent: ").append(DateUtils.getRelativeTimeSpanString(okAt));
    if (failAt > okAt) d.append("\n⚠️ ").append(Queue.result(this));
    int waiting = Queue.size(this);
    if (waiting > 0) d.append("\nWaiting to send: ").append(waiting);
    detail.setText(d);
  }

  private void sendTest() {
    test.setText("Sending… (can take up to a minute)");
    new Thread(new Runnable() { public void run() {
      final int code = Queue.post("VIBEX-APP", "Test from the Vibe X Payments app at " + System.currentTimeMillis());
      runOnUiThread(new Runnable() { public void run() {
        if (code >= 200 && code < 300) test.setText("✅ The website got the test. All set.");
        else if (code == 401) test.setText("❌ The website refused this app's key. Ask for a new app.");
        else if (code == -1) test.setText("❌ No internet, or the website didn't answer. Try again.");
        else test.setText("❌ The website answered " + code + ". Try again in a minute.");
      } });
    } }).start();
  }

  private TextView text(String s, int sp, boolean bold, int color) {
    TextView t = new TextView(this);
    t.setText(s); t.setTextSize(sp); t.setTextColor(color);
    if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
    t.setLineSpacing(0, 1.2f);
    return t;
  }

  private Button button(String s) {
    Button b = new Button(this);
    b.setText(s); b.setTextSize(17); b.setAllCaps(false);
    b.setMinHeight(dp(56)); b.setGravity(Gravity.CENTER);
    return b;
  }

  private LinearLayout.LayoutParams gap(int top) {
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    lp.topMargin = dp(top);
    return lp;
  }

  private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}

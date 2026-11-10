package com.vibexindia.payments;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONArray;
import org.json.JSONObject;

/** SMS waiting to be sent (kept on the phone until the website says it got them), and the status shown on screen. */
final class Queue {
  private static final String P = "vibex";

  private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(P, Context.MODE_PRIVATE); }

  static synchronized void add(Context c, String from, String text) {
    try {
      JSONArray q = list(c);
      JSONObject o = new JSONObject();
      o.put("from", from); o.put("text", text); o.put("at", System.currentTimeMillis());
      q.put(o);
      // Never grow without limit: a bank SMS older than the newest 200 is no longer useful.
      while (q.length() > 200) q.remove(0);
      prefs(c).edit().putString("q", q.toString()).apply();
    } catch (Exception ignored) { }
  }

  static synchronized JSONArray list(Context c) {
    try { return new JSONArray(prefs(c).getString("q", "[]")); } catch (Exception e) { return new JSONArray(); }
  }

  static synchronized void removeFirst(Context c) {
    JSONArray q = list(c);
    if (q.length() > 0) q.remove(0);
    prefs(c).edit().putString("q", q.toString()).apply();
  }

  static int size(Context c) { return list(c).length(); }

  static void status(Context c, boolean ok, String result) {
    prefs(c).edit().putLong(ok ? "lastOk" : "lastFail", System.currentTimeMillis()).putString("result", result).apply();
  }
  static long lastOk(Context c) { return prefs(c).getLong("lastOk", 0); }
  static long lastFail(Context c) { return prefs(c).getLong("lastFail", 0); }
  static String result(Context c) { return prefs(c).getString("result", ""); }

  /** POST one SMS to the website. Returns the HTTP status, or -1 when the internet failed. */
  static int post(String from, String text) {
    HttpURLConnection h = null;
    try {
      JSONObject body = new JSONObject();
      body.put("from", from); body.put("text", text); body.put("app", "vibex-payments/1");
      byte[] b = body.toString().getBytes("UTF-8");
      h = (HttpURLConnection) new URL(Config.URL + "?t=" + Config.TOKEN).openConnection();
      h.setRequestMethod("POST");
      h.setConnectTimeout(30000);
      h.setReadTimeout(90000); // the free test site can take ~a minute to wake up
      h.setDoOutput(true);
      h.setRequestProperty("Content-Type", "application/json; charset=utf-8");
      OutputStream os = h.getOutputStream(); os.write(b); os.close();
      return h.getResponseCode();
    } catch (Exception e) {
      return -1;
    } finally {
      if (h != null) h.disconnect();
    }
  }
}

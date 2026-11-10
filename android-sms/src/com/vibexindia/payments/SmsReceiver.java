package com.vibexindia.payments;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/** Every new SMS lands here. Only bank "money received" messages are kept; personal messages never leave the phone. */
public class SmsReceiver extends BroadcastReceiver {
  // Banks send from names like "JK-JKBANK"; people send from numbers. Numbers are never forwarded.
  private static final Pattern HAS_LETTER = Pattern.compile("[A-Za-z]");
  private static final Pattern MONEY_IN = Pattern.compile("(?i)\\b(credited|credit|received|deposited|cr)\\b");
  private static final Pattern AMOUNT = Pattern.compile("(?i)(rs\\.?|inr|₹)\\s*:?\\s*[\\d,]+");

  static boolean isBankCredit(String from, String text) {
    return from != null && HAS_LETTER.matcher(from).find() && MONEY_IN.matcher(text).find() && AMOUNT.matcher(text).find();
  }

  @Override public void onReceive(Context c, Intent i) {
    if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(i.getAction())) return;
    SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(i);
    if (parts == null) return;
    // A long SMS arrives in pieces: join them per sender.
    Map<String, StringBuilder> by = new LinkedHashMap<>();
    for (SmsMessage m : parts) {
      if (m == null) continue;
      String from = m.getDisplayOriginatingAddress();
      StringBuilder sb = by.get(from);
      if (sb == null) { sb = new StringBuilder(); by.put(from, sb); }
      sb.append(m.getDisplayMessageBody());
    }
    boolean any = false;
    for (Map.Entry<String, StringBuilder> e : by.entrySet()) {
      String text = e.getValue().toString();
      if (isBankCredit(e.getKey(), text)) { Queue.add(c, e.getKey(), text); any = true; }
    }
    if (any) SendJob.schedule(c);
  }
}

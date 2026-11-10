package com.vibexindia.payments;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import org.json.JSONObject;

/** Sends waiting SMS as soon as there is internet. Android runs it even if the app is closed, and retries on failure. */
public class SendJob extends JobService {
  static void schedule(Context c) {
    JobInfo job = new JobInfo.Builder(1, new ComponentName(c, SendJob.class))
        .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
        .setBackoffCriteria(30000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
        .setPersisted(true)
        .build();
    JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
    if (js != null) js.schedule(job);
  }

  @Override public boolean onStartJob(final JobParameters p) {
    new Thread(new Runnable() { public void run() { jobFinished(p, !drain(SendJob.this)); } }).start();
    return true;
  }

  @Override public boolean onStopJob(JobParameters p) { return true; }

  /** True when nothing is left to send. */
  static boolean drain(Context c) {
    while (Queue.size(c) > 0) {
      JSONObject o = Queue.list(c).optJSONObject(0);
      if (o == null) { Queue.removeFirst(c); continue; }
      int code = Queue.post(o.optString("from"), o.optString("text"));
      if (code >= 200 && code < 300) { Queue.removeFirst(c); Queue.status(c, true, "Sent to the website"); continue; }
      if (code == 401) { Queue.status(c, false, "The website refused the key. Ask for a new app."); return false; }
      if (code >= 400 && code < 500) { Queue.removeFirst(c); Queue.status(c, false, "The website rejected one message (" + code + ")"); continue; }
      Queue.status(c, false, code == -1 ? "No internet, will retry" : "Website busy (" + code + "), will retry");
      return false;
    }
    return true;
  }
}

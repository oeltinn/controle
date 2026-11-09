-- New Supabase tables inherit broad grants for authenticated; limit the Data API.
revoke all on public.app_notifications, public.app_notification_recipients,
  public.push_subscriptions from authenticated;
grant select on public.app_notifications, public.app_notification_recipients to authenticated;

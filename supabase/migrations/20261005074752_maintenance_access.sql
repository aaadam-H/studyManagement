drop policy if exists settings_maintenance_anon_read on public.settings;
create policy settings_maintenance_anon_read on public.settings for select to anon
  using (key in ('maintenance_enabled', 'maintenance_message', 'maintenance_start', 'maintenance_end'));
grant select on public.settings to anon;

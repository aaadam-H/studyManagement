export function supportsAppleCalendarSubscribe(userAgent, maxTouchPoints = 0) {
  return /iPhone|iPad|iPod|Macintosh/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
}

export function restoreCalendarSubscribeLinks(root, supabaseUrl) {
  const trustedOrigin = new URL(supabaseUrl).origin;
  root.querySelectorAll('a[data-calendar-subscribe]').forEach((link) => {
    try {
      const url = new URL(link.getAttribute('href'));
      if (url.protocol === 'https:' && url.origin === trustedOrigin) {
        link.setAttribute('href', url.href.replace(/^https:/, 'webcal:'));
      }
    } catch (error) {
      console.warn('Calendar subscription link could not be prepared:', error);
    }
  });
}

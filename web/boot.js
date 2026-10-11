// Keep a failed module request from leaving an empty page after an update.
const script = document.currentScript;
const app = document.getElementById('app');
const showFailure = () => {
  if (app.querySelector('.startup-error')) return;
  app.replaceChildren();
  const panel = document.createElement('main');
  panel.className = 'startup-error';
  const heading = document.createElement('h1');
  heading.textContent = 'StudyHub could not load';
  const text = document.createElement('p');
  text.textContent = 'The site may have just updated. Reload to get the latest files.';
  const reload = document.createElement('a');
  const target = new URL(window.location.href);
  target.searchParams.set('reload', Date.now().toString());
  reload.href = target.href;
  reload.textContent = 'Reload StudyHub';
  panel.append(heading, text, reload);
  app.append(panel);
};
window.addEventListener('unhandledrejection', () => {
  if (!app.textContent.trim()) showFailure();
});
const moduleUrl = new URL(`app.js?v=${script.dataset.version}`, script.src);
import(moduleUrl.href).catch((error) => {
  console.error('StudyHub startup failed:', error);
  showFailure();
});

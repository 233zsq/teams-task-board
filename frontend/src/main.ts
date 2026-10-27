import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';

const app = createApp(App);

app.config.errorHandler = (error) => {
  // Runtime rendering failures must never leave a blank workspace; the shell
  // listens for this signal and shows a recoverable error page.
  window.dispatchEvent(
    new CustomEvent('app:fatal', {
      detail: error instanceof Error ? error.message : String(error),
    }),
  );
};
window.addEventListener('unhandledrejection', (event) => {
  window.dispatchEvent(
    new CustomEvent('app:fatal', {
      detail: event.reason instanceof Error ? event.reason.message : String(event.reason),
    }),
  );
});

app.use(router);
app.mount('#app');
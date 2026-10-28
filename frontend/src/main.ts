import { createApp } from 'vue';
import AccountGate from './features/accounts/AccountGate.vue';
import { router } from './router';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/accounts.css';
import './styles/task-search.css';

const app = createApp(AccountGate);

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

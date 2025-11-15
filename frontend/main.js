import { createApp } from 'vue';
import App from './App.vue';
import * as bootstrap from 'bootstrap';

window.bootstrap = bootstrap;

const app = createApp(App);
app.mount('#app');
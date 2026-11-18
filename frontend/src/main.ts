import { createApp } from 'vue'
import App from './App.vue'
import { reveal } from './reveal'
import './style.css'
import './forum.css'
import './phase5.css'
import './inch.css'
import './pages.css'
import './motion.css'
const app = createApp(App)
app.directive('reveal', reveal)
app.mount('#app')

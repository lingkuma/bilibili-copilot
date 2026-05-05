import { mount } from 'svelte'
import { browser } from 'wxt/browser'
import App from './App.svelte'
import './style.css'

const extensionName = browser.i18n.getMessage('extensionName')
if (extensionName) {
  document.title = extensionName
}

mount(App, {
  target: document.getElementById('app')!,
})

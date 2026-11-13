// Error boundary around the whole web app (ADR 0082 §1): only an error while rendering leaves the UI broken and
// counts as a crash. It is recorded, instead of the empty page there is a sentence with „Neu laden“; after loading
// the card above the conversations asks whether we get the report. Errors in click handlers, from extensions or
// rejected promises do not count: after them the page keeps running.
import { Component, type ComponentChildren } from 'preact'
import { texts } from '../i18n'
import { recordCrash } from '../core/crashes'
import { browserDeviceName } from '../core/device'
import { Button } from './components'

export class CrashBoundary extends Component<{ children: ComponentChildren }, { failed: boolean }> {
  state = { failed: false }

  componentDidCatch(error: unknown) {
    recordCrash(error, __APP_VERSION__, browserDeviceName())
    this.setState({ failed: true })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main class="center-screen">
        <img src="/brand/anynear-emblem.svg" width="65" height="56" alt="" />
        <h1>{texts.support.crashScreenTitle}</h1>
        <p>{texts.support.crashScreenText}</p>
        <Button kind="main" onClick={() => location.reload()}>
          {texts.support.crashScreenReload}
        </Button>
      </main>
    )
  }
}

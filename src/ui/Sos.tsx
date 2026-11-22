// Calls for help in the browser, as on the phone (SosUi.kt, ADR 0121 §14, 22.11.2026): a red line on every page while
// a call runs, and the call with its exact place, battery and „Ich kümmere mich“. The browser never raises a call and
// never rings; it has no map of its own, so the place opens on OpenStreetMap, only by a button.
import { useState } from "preact/hooks";
import { texts } from "../i18n";
import { accuracyText, mapLink, nameOf } from "../core/lifesigns";
import { me } from "../core/session";
import {
  careSos,
  sosCalls,
  sosHelpers,
  sosOpen,
  switchOffSos,
  type SosCallView,
} from "../core/sos";
import { Button, Dialog } from "./components";
import { formatDateTime, formatTime } from "./format";

/** The call the line is about: someone else's first, the own one (running on the phone) otherwise. */
function shownCall(): SosCallView | undefined {
  const running = sosCalls.value.filter((c) => !c.ended);
  return running.find((c) => !c.own) ?? running.find((c) => c.own);
}

/** The red line across the top while a call runs; a tap opens it. */
export function SosBanner() {
  const call = shownCall();
  if (!call) return null;
  const t = texts.sos;
  return (
    <button
      type="button"
      class="sos-banner"
      onClick={() => (sosOpen.value = call.id)}
    >
      {call.own
        ? t.ownBanner
        : call.fromCheckIn
          ? t.missedTitle(nameOf(call.owner))
          : t.activeBanner(nameOf(call.owner))}
    </button>
  );
}

function caringText(call: SosCallView): string {
  const t = texts.sos;
  const names = call.caring.map(nameOf);
  return names.length === 0
    ? t.nobodyCares
    : names.length === 1
      ? t.cares(names[0])
      : t.caresMany(names.join(", "));
}

/** The call: where (exactly, as it came), since when, the battery, who looks after it, and „Ich kümmere mich“. */
export function SosCallDialog() {
  const id = sosOpen.value;
  const call = sosCalls.value.find((c) => c.id === id);
  if (!call) return null;
  const t = texts.sos;
  const who = nameOf(call.owner);
  const mine =
    me.value?.personId != null && call.caring.includes(me.value.personId);
  const close = () => (sosOpen.value = null);
  return (
    <Dialog
      title={
        call.own
          ? t.callTitle
          : call.fromCheckIn
            ? t.missedTitle(who)
            : t.needsHelp(who)
      }
      onClose={close}
    >
      <div class="dialog-body">
        <div class="alert-card alarm">
          <span class="alert-text">
            {[
              t.since(formatTime(call.start)),
              call.battery != null ? t.battery(call.battery) : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {call.place ? (
            <>
              <span class="alert-text">
                <strong>
                  {[
                    t.placeFrom(formatDateTime(call.place.at)),
                    call.place.accuracy != null
                      ? accuracyText(call.place.accuracy)
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </strong>
              </span>
              <a
                class="btn btn-secondary alert-open"
                href={mapLink(call.place)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t.showOnMap}
              </a>
            </>
          ) : (
            <span class="alert-text">{t.noPlace}</span>
          )}
          <span class="alert-title">{caringText(call)}</span>
          {call.own ? (
            <span class="alert-text">{t.ownRunning}</span>
          ) : (
            !call.ended && (
              <span class="alert-actions">
                {mine ? (
                  <span class="alert-text">
                    <strong>{t.youCare}</strong>
                  </span>
                ) : (
                  <Button kind="main" onClick={() => void careSos(call.id)}>
                    {t.iCare}
                  </Button>
                )}
              </span>
            )
          )}
        </div>
        <p class="muted small">{t.not112}</p>
      </div>
    </Dialog>
  );
}

/** „SOS ausschalten“ below the choice of SOS contacts, with a question first; only while some are chosen. */
export function SosSwitchOff() {
  const [asking, setAsking] = useState(false);
  const h = sosHelpers.value;
  const t = texts.sos;
  if (h.circles.length === 0 && h.persons.length === 0) return null;
  // A running own call is ended on the phone with „Alles gut“, not by switching off.
  if (sosCalls.value.some((c) => c.own && !c.ended)) return null;
  return (
    <>
      <div class="dialog-actions">
        <Button kind="quiet" onClick={() => setAsking(true)}>
          {t.switchOff}
        </Button>
      </div>
      {asking && (
        <Dialog title={t.switchOffTitle} onClose={() => setAsking(false)}>
          <div class="dialog-body">
            <p>{t.switchOffText}</p>
            <div class="dialog-actions">
              <Button kind="quiet" onClick={() => setAsking(false)}>
                {t.cancel}
              </Button>
              <Button
                kind="danger"
                onClick={() => {
                  void switchOffSos();
                  setAsking(false);
                }}
              >
                {t.switchOffConfirm}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

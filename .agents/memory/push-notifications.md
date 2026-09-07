---
name: Browser-closed reminders
description: The memorizer uses standard Web Push with a service worker and server-side due-review checks.
---

Browser-closed reminders are implemented with Web Push rather than page-local timers: the browser registers a service worker subscription, the server stores the subscription and generated VAPID key pair, and a periodic server worker sends due-review notifications.

**Why:** A browser page cannot reliably create OS notifications after it has been closed; a push-capable service worker and server sender are required.

**How to apply:** Keep notification permission, push subscription, and due-review scheduling as separate concerns when extending reminder behavior.
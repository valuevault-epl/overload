# Overload

Gym log: sets and reps, per-lift progress charts (by session or by week), a weekly plan with streaks, and a 12-week consistency grid. It installs to a phone's home screen and works offline. Data syncs through Firebase.

Live at https://valuevault-epl.github.io/overload/

## How it fits together

- `index.html`, `styles.css` and `app.js` make up the whole app. It uses Preact and htm from cdnjs, and Firebase 13 ES modules from gstatic. There's no build step.
- `firebase-config.js` holds the Firebase web config, which is public by design.
- `firestore.rules` is pasted into Firebase console > Firestore > Rules. Each signed-in user can only touch `users/{uid}` and `users/{uid}/workouts/*`.
- `sw.js` is the service worker. The app's own files are network-first with a 3.5 s fallback to cache, and CDN files are cache-first.
- `manifest.webmanifest` and `icons/` cover home-screen install.

## Data shape

- `users/{uid}` (plan): `unit`, `weeklyGoal`, `exercises {id: {name, group}}`, `templates {id: {name, exIds}}`, `week {mon..sun: {tpl, time}}`, `createdOn`
- `users/{uid}/workouts/{id}`: `date`, `name`, `tpl`, `note`, `live`, `savedAt`, `items [{ex, n, sets [{w (kg, null = bodyweight), r, d}]}]`

## Firebase setup (one time, free Spark plan)

1. Go to console.firebase.google.com, choose **Create a project** and name it (e.g. `overload-gym`). You can turn Analytics off.
2. Under **Build > Authentication**, choose **Get started**, then **Email/Password**, and enable it.
3. Under **Build > Firestore Database**, choose **Create database**. Pick location `australia-southeast1` and start in **production mode**.
4. In Firestore, open the **Rules** tab, paste in `firestore.rules`, and choose **Publish**.
5. In **Project settings** (gear icon) > **Your apps**, click the web icon `</>`, register the app as "Overload" (no Hosting needed), then copy the `firebaseConfig` values into `firebase-config.js`.

## Deploy

Pushing to `main` publishes the site through GitHub Pages.

# Selective Shuffle

Type `artist 1 + artist 2 + artist 3` (or any combination of artists separated by `+`, `,`, or `&`) to pull deep cuts across their full discographies and shuffle them together immediately.

## Features

- **Expression Search Bar**: Type multiple artists (`artist 1 + artist 2 + artist 3`) and see live matched artist chips. Click any chip to switch artists if a name is shared by multiple acts.
- **Full Discography / Deep Cuts**: Pulls albums and singles for each artist, deduplicates remasters/clean-explicit duplicates, and caches discographies in memory for instant re-shuffling.
- **Balanced vs. Pure Random Mix**:
  - **Balanced per artist** *(default)*: Interleaves rounds across your chosen artists so an artist with 100 songs doesn't drown out an artist with 10 songs.
  - **Pure random pool**: Pools all tracks together with equal weight.
- **Direct Playback + Playlist Mode**:
  - Plays directly on your active Spotify device via Spotify Connect.
  - Also supports updating a single reusable **`Selective Shuffle ⚡`** playlist (zero library clutter) or saving as a new playlist and opening it directly in the Spotify app.
- **Responsive & PWA-Ready**: Installable to your home screen on iOS, Android, tablet, or desktop.

## Quick Start (Local PC)

1. Run the zero-dependency server:
   ```bash
   npm start
   ```
2. Open **[http://127.0.0.1:5173/](http://127.0.0.1:5173/)** in your browser.
3. Click **Connect Spotify** (or the gear icon) and follow the 60-second setup guide to paste your Spotify Developer Client ID and add `http://127.0.0.1:5173/` as a Redirect URI.

## Hosting for Phone & Tablet Access

Because this is a pure static client-side app using Spotify's OAuth 2.0 PKCE flow (no backend or secret required):
- Push this folder to **GitHub Pages**, **Vercel**, or **Netlify**.
- Add your hosted `https://...` URL to your Spotify Developer App's Redirect URIs.
- Use the **Copy Link** button in the app's settings modal to open the app on your phone or tablet with your Client ID pre-filled.

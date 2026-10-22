/*
 * Where is the SpaceSkribble backend?
 *
 *   ''                          -> the same server that served this page (normal / Render / localhost)
 *   'https://your-app.onrender.com' -> use this only if the website files are hosted somewhere
 *                                      else (for example Netlify) and the Node server is on Render.
 *
 * Do not put secret keys in this file. It is public.
 */
window.SS_API_BASE = window.SS_API_BASE || '';

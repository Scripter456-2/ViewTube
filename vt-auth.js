/**
 * ViewTube — Shared Auth & Data Engine (vt-auth.js)
 * All data lives in localStorage, fully client-side.
 * Works on GitHub Pages with zero backend.
 */

const VT = (() => {

  // ── STORAGE KEYS ─────────────────────────────────────────────
  const KEYS = {
    USERS:      'vt_users',
    SESSION:    'vt_session',
    CHANNELS:   'vt_channels',      // user-created + seed
    VIDEOS:     'vt_videos',        // user-uploaded + seed
    SHORTS:     'vt_shorts',
    COMMENTS:   'vt_comments',
    SUBS:       'vt_subscriptions', // { userId: [channelId, ...] }
    LIKES:      'vt_likes',         // { userId: [videoId, ...] }
    DISLIKES:   'vt_dislikes',
    VIEWS:      'vt_views',         // { videoId: count }
  };

  // ── HELPERS ───────────────────────────────────────────────────
  const store = {
    get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  };

  function hashPassword(pw) {
    // Simple deterministic hash (not cryptographic, but sufficient for a client demo)
    let h = 0;
    for (let i = 0; i < pw.length; i++) {
      h = Math.imul(31, h) + pw.charCodeAt(i) | 0;
    }
    return 'h' + Math.abs(h).toString(36) + pw.length.toString(36);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function fmtSubs(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + 'M';
    if (n >= 1000)    return (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'K';
    return String(n);
  }

  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1)   return 'Just now';
    if (m < 60)  return m + ' minute' + (m > 1 ? 's' : '') + ' ago';
    const h = Math.floor(m / 60);
    if (h < 24)  return h + ' hour' + (h > 1 ? 's' : '') + ' ago';
    const d = Math.floor(h / 24);
    if (d < 30)  return d + ' day' + (d > 1 ? 's' : '') + ' ago';
    const mo = Math.floor(d / 30);
    if (mo < 12) return mo + ' month' + (mo > 1 ? 's' : '') + ' ago';
    return Math.floor(mo / 12) + ' year(s) ago';
  }

  // ── SEED DATA INIT ────────────────────────────────────────────
  // Merges fetched JSON seed data into localStorage on first load
  async function initSeedData() {
    // Only fetch if we haven't seeded yet
    if (store.get(KEYS.CHANNELS) && store.get(KEYS.VIDEOS)) return;

    try {
      const [seedCh, seedVid, seedShorts, seedComments] = await Promise.all([
        fetch('channels.json').then(r => r.json()),
        fetch('videos.json').then(r => r.json()),
        fetch('shorts.json').then(r => r.json()),
        fetch('comments.json').then(r => r.json()),
      ]);

      if (!store.get(KEYS.CHANNELS)) store.set(KEYS.CHANNELS, seedCh);
      if (!store.get(KEYS.VIDEOS))   store.set(KEYS.VIDEOS, seedVid);
      if (!store.get(KEYS.SHORTS))   store.set(KEYS.SHORTS, seedShorts);
      if (!store.get(KEYS.COMMENTS)) store.set(KEYS.COMMENTS, seedComments);
    } catch (e) {
      // Fallback: init with empty arrays
      if (!store.get(KEYS.CHANNELS)) store.set(KEYS.CHANNELS, []);
      if (!store.get(KEYS.VIDEOS))   store.set(KEYS.VIDEOS, []);
      if (!store.get(KEYS.SHORTS))   store.set(KEYS.SHORTS, []);
      if (!store.get(KEYS.COMMENTS)) store.set(KEYS.COMMENTS, {});
    }

    if (!store.get(KEYS.USERS))    store.set(KEYS.USERS, []);
    if (!store.get(KEYS.SUBS))     store.set(KEYS.SUBS, {});
    if (!store.get(KEYS.LIKES))    store.set(KEYS.LIKES, {});
    if (!store.get(KEYS.DISLIKES)) store.set(KEYS.DISLIKES, {});
    if (!store.get(KEYS.VIEWS))    store.set(KEYS.VIEWS, {});
  }

  // ── AUTH ──────────────────────────────────────────────────────
  function getUsers()    { return store.get(KEYS.USERS) || []; }
  function getSession()  { return store.get(KEYS.SESSION); }

  function currentUser() {
    const s = getSession();
    if (!s) return null;
    return getUsers().find(u => u.id === s.userId) || null;
  }

  function register({ username, email, password, displayName }) {
    const users = getUsers();
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
      return { ok: false, error: 'Email already registered.' };
    }
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
      return { ok: false, error: 'Username already taken.' };
    }
    if (password.length < 6) {
      return { ok: false, error: 'Password must be at least 6 characters.' };
    }
    const user = {
      id: 'u_' + uid(),
      username: username.trim(),
      email: email.toLowerCase().trim(),
      displayName: (displayName || username).trim(),
      passwordHash: hashPassword(password),
      avatar: `https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(username)}`,
      channelId: null,
      createdAt: Date.now(),
    };
    users.push(user);
    store.set(KEYS.USERS, users);
    _createSession(user);
    return { ok: true, user };
  }

  function login({ email, password }) {
    const users = getUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) return { ok: false, error: 'No account with that email.' };
    if (user.passwordHash !== hashPassword(password)) {
      return { ok: false, error: 'Incorrect password.' };
    }
    _createSession(user);
    return { ok: true, user };
  }

  function logout() {
    localStorage.removeItem(KEYS.SESSION);
    window.location.href = 'index.html';
  }

  function _createSession(user) {
    store.set(KEYS.SESSION, { userId: user.id, at: Date.now() });
  }

  function requireAuth(redirect = 'login.html') {
    if (!currentUser()) {
      window.location.href = redirect;
      return false;
    }
    return true;
  }

  // ── CHANNELS ──────────────────────────────────────────────────
  function getChannels() { return store.get(KEYS.CHANNELS) || []; }
  function getChannel(id) { return getChannels().find(c => c.id === id) || null; }
  function getChannelByOwner(userId) { return getChannels().find(c => c.ownerId === userId) || null; }

  function createChannel({ name, handle, description, avatar, banner, ownerId }) {
    const channels = getChannels();
    const cleanHandle = handle.startsWith('@') ? handle : '@' + handle;
    if (channels.find(c => c.handle.toLowerCase() === cleanHandle.toLowerCase())) {
      return { ok: false, error: 'Handle already taken.' };
    }
    const ch = {
      id: 'ch_' + uid(),
      name: name.trim(),
      handle: cleanHandle.toLowerCase(),
      description: (description || '').trim(),
      avatar: avatar || `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(name)}&backgroundColor=0f0f23`,
      banner: banner || `https://picsum.photos/seed/${encodeURIComponent(name)}/1200/300`,
      subscribers: '0',
      subscriberCount: 0,
      IsVerified: false,
      IsGoldVerified: false,
      IsBlackVerified: false,
      IsBanned: false,
      ownerId,
      createdAt: Date.now(),
    };
    channels.push(ch);
    store.set(KEYS.CHANNELS, channels);

    // Link channel to user
    const users = getUsers();
    const idx = users.findIndex(u => u.id === ownerId);
    if (idx !== -1) { users[idx].channelId = ch.id; store.set(KEYS.USERS, users); }

    return { ok: true, channel: ch };
  }

  function updateChannel(channelId, changes, requesterId) {
    const channels = getChannels();
    const idx = channels.findIndex(c => c.id === channelId);
    if (idx === -1) return { ok: false, error: 'Channel not found.' };
    if (channels[idx].ownerId !== requesterId) return { ok: false, error: 'Not your channel.' };
    Object.assign(channels[idx], changes);
    store.set(KEYS.CHANNELS, channels);
    return { ok: true, channel: channels[idx] };
  }

  // ── SUBSCRIPTIONS ─────────────────────────────────────────────
  function getSubs()         { return store.get(KEYS.SUBS) || {}; }
  function getUserSubs(uid)  { return (getSubs()[uid] || []); }

  function isSubscribed(userId, channelId) {
    return getUserSubs(userId).includes(channelId);
  }

  function toggleSubscribe(userId, channelId) {
    const subs = getSubs();
    const list = subs[userId] || [];
    const channels = getChannels();
    const chIdx = channels.findIndex(c => c.id === channelId);
    let wasSubbed;

    if (list.includes(channelId)) {
      subs[userId] = list.filter(id => id !== channelId);
      wasSubbed = true;
      if (chIdx !== -1) {
        channels[chIdx].subscriberCount = Math.max(0, (channels[chIdx].subscriberCount || 0) - 1);
        channels[chIdx].subscribers = fmtSubs(channels[chIdx].subscriberCount);
      }
    } else {
      subs[userId] = [...list, channelId];
      wasSubbed = false;
      if (chIdx !== -1) {
        channels[chIdx].subscriberCount = (channels[chIdx].subscriberCount || 0) + 1;
        channels[chIdx].subscribers = fmtSubs(channels[chIdx].subscriberCount);
      }
    }
    store.set(KEYS.SUBS, subs);
    store.set(KEYS.CHANNELS, channels);
    return { subscribed: !wasSubbed, count: chIdx !== -1 ? channels[chIdx].subscriberCount : 0 };
  }

  // ── VIDEOS ────────────────────────────────────────────────────
  function getVideos() {
    return (store.get(KEYS.VIDEOS) || []).filter(v => !v.IsBanned);
  }
  function getAllVideos() { return store.get(KEYS.VIDEOS) || []; }
  function getVideo(id) { return getAllVideos().find(v => v.id === id) || null; }
  function getChannelVideos(channelId) {
    return getVideos().filter(v => v.channelId === channelId);
  }

  function uploadVideo({ title, description, tags, category, thumbnail, videoUrl, channelId, uploaderId }) {
    const videos = getAllVideos();
    const vid = {
      id: 'v_' + uid(),
      title: title.trim(),
      description: (description || '').trim(),
      tags: Array.isArray(tags) ? tags : (tags || '').split(',').map(t => t.trim()).filter(Boolean),
      category: category || 'Other',
      thumbnail: thumbnail || `https://picsum.photos/seed/${uid()}/640/360`,
      videoUrl: videoUrl || '',
      channelId,
      uploaderId,
      views: 0,
      viewsLabel: '0',
      likes: 0,
      dislikes: 0,
      duration: '0:00',
      uploadedAgo: 'Just now',
      uploadedAt: Date.now(),
      trending: false,
      IsBanned: false,
    };
    videos.push(vid);
    store.set(KEYS.VIDEOS, videos);
    return { ok: true, video: vid };
  }

  function deleteVideo(videoId, requesterId) {
    const videos = getAllVideos();
    const vid = videos.find(v => v.id === videoId);
    if (!vid) return { ok: false, error: 'Video not found.' };
    const ch = getChannel(vid.channelId);
    if (!ch || ch.ownerId !== requesterId) return { ok: false, error: 'Not your video.' };
    store.set(KEYS.VIDEOS, videos.filter(v => v.id !== videoId));
    return { ok: true };
  }

  // ── VIEW COUNTING ─────────────────────────────────────────────
  function recordView(videoId) {
    const views = store.get(KEYS.VIEWS) || {};
    views[videoId] = (views[videoId] || 0) + 1;
    store.set(KEYS.VIEWS, views);

    // Also update in videos array
    const videos = getAllVideos();
    const idx = videos.findIndex(v => v.id === videoId);
    if (idx !== -1) {
      videos[idx].views = (videos[idx].views || 0) + 1;
      videos[idx].viewsLabel = fmtSubs(videos[idx].views);
      store.set(KEYS.VIDEOS, videos);
    }
  }

  // ── LIKES / DISLIKES ──────────────────────────────────────────
  function getLikes()    { return store.get(KEYS.LIKES) || {}; }
  function getDislikes() { return store.get(KEYS.DISLIKES) || {}; }

  function hasLiked(userId, videoId)    { return (getLikes()[userId] || []).includes(videoId); }
  function hasDisliked(userId, videoId) { return (getDislikes()[userId] || []).includes(videoId); }

  function toggleLike(userId, videoId) {
    const likes = getLikes();
    const dislikes = getDislikes();
    const videos = getAllVideos();
    const idx = videos.findIndex(v => v.id === videoId);

    const alreadyLiked = (likes[userId] || []).includes(videoId);
    const alreadyDisliked = (dislikes[userId] || []).includes(videoId);

    if (alreadyLiked) {
      likes[userId] = (likes[userId] || []).filter(id => id !== videoId);
      if (idx !== -1) videos[idx].likes = Math.max(0, (videos[idx].likes || 0) - 1);
    } else {
      likes[userId] = [...(likes[userId] || []), videoId];
      if (idx !== -1) videos[idx].likes = (videos[idx].likes || 0) + 1;
      // Remove dislike if present
      if (alreadyDisliked) {
        dislikes[userId] = (dislikes[userId] || []).filter(id => id !== videoId);
        if (idx !== -1) videos[idx].dislikes = Math.max(0, (videos[idx].dislikes || 0) - 1);
      }
    }
    store.set(KEYS.LIKES, likes);
    store.set(KEYS.DISLIKES, dislikes);
    store.set(KEYS.VIDEOS, videos);
    return {
      liked: !alreadyLiked,
      likes: idx !== -1 ? videos[idx].likes : 0,
      dislikes: idx !== -1 ? videos[idx].dislikes : 0,
    };
  }

  function toggleDislike(userId, videoId) {
    const likes = getLikes();
    const dislikes = getDislikes();
    const videos = getAllVideos();
    const idx = videos.findIndex(v => v.id === videoId);

    const alreadyLiked = (likes[userId] || []).includes(videoId);
    const alreadyDisliked = (dislikes[userId] || []).includes(videoId);

    if (alreadyDisliked) {
      dislikes[userId] = (dislikes[userId] || []).filter(id => id !== videoId);
      if (idx !== -1) videos[idx].dislikes = Math.max(0, (videos[idx].dislikes || 0) - 1);
    } else {
      dislikes[userId] = [...(dislikes[userId] || []), videoId];
      if (idx !== -1) videos[idx].dislikes = (videos[idx].dislikes || 0) + 1;
      if (alreadyLiked) {
        likes[userId] = (likes[userId] || []).filter(id => id !== videoId);
        if (idx !== -1) videos[idx].likes = Math.max(0, (videos[idx].likes || 0) - 1);
      }
    }
    store.set(KEYS.LIKES, likes);
    store.set(KEYS.DISLIKES, dislikes);
    store.set(KEYS.VIDEOS, videos);
    return {
      disliked: !alreadyDisliked,
      likes: idx !== -1 ? videos[idx].likes : 0,
      dislikes: idx !== -1 ? videos[idx].dislikes : 0,
    };
  }

  // ── COMMENTS ──────────────────────────────────────────────────
  function getComments()           { return store.get(KEYS.COMMENTS) || {}; }
  function getVideoComments(vid)   { return (getComments()[vid] || []); }

  function addComment(videoId, { userId, text }) {
    const user = getUsers().find(u => u.id === userId);
    if (!user) return { ok: false, error: 'Not logged in.' };
    const all = getComments();
    const comment = {
      id: 'c_' + uid(),
      user: user.displayName || user.username,
      avatar: user.avatar,
      userId,
      text: text.trim(),
      likes: 0,
      time: 'Just now',
      postedAt: Date.now(),
      replies: [],
    };
    all[videoId] = [comment, ...(all[videoId] || [])];
    store.set(KEYS.COMMENTS, all);
    return { ok: true, comment };
  }

  function addReply(videoId, commentId, { userId, text }) {
    const user = getUsers().find(u => u.id === userId);
    if (!user) return { ok: false, error: 'Not logged in.' };
    const all = getComments();
    const list = all[videoId] || [];
    const cIdx = list.findIndex(c => c.id === commentId);
    if (cIdx === -1) return { ok: false, error: 'Comment not found.' };
    const reply = {
      id: 'r_' + uid(),
      user: user.displayName || user.username,
      avatar: user.avatar,
      userId,
      text: text.trim(),
      likes: 0,
      time: 'Just now',
      postedAt: Date.now(),
    };
    list[cIdx].replies = [...(list[cIdx].replies || []), reply];
    store.set(KEYS.COMMENTS, all);
    return { ok: true, reply };
  }

  // ── BADGE HTML ────────────────────────────────────────────────
  function badgeHTML(ch, size = 14) {
    if (!ch) return '';
    const s = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor"`;
    const star = `<svg ${s}><path d="M12 2l2.09 6.26L21 9.27l-5 4.87 1.18 6.88L12 17.77l-5.18 3.25L8 14.14 3 9.27l6.91-1.01z"/></svg>`;
    const check = `<svg ${s}><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
    if (ch.IsBanned)         return `<span class="badge badge-banned" title="Banned">🚫</span>`;
    if (ch.IsBlackVerified)  return `<span class="badge badge-black" title="Black Verified">${star}</span>`;
    if (ch.IsGoldVerified)   return `<span class="badge badge-gold" title="Gold Verified">${star}</span>`;
    if (ch.IsVerified)       return `<span class="badge badge-verified" title="Verified">${check}</span>`;
    return '';
  }

  // ── TOPBAR HTML (shared across all pages) ────────────────────
  function renderTopbar(activePage = '') {
    const user = currentUser();
    const userChannel = user ? getChannelByOwner(user.id) : null;
    const initials = user ? (user.displayName || user.username).charAt(0).toUpperCase() : '';

    const authSection = user ? `
      <div class="tb-user-menu" id="tbUserMenu">
        <button class="tb-avatar-btn" onclick="VT.toggleUserDropdown()" title="${user.displayName || user.username}">
          <img src="${user.avatar}" alt="${initials}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <span style="display:none">${initials}</span>
        </button>
        <div class="tb-dropdown" id="tbDropdown">
          <div class="tb-dropdown-header">
            <img src="${user.avatar}" class="tb-drop-avatar" onerror="this.style.display='none'">
            <div>
              <div class="tb-drop-name">${user.displayName || user.username}</div>
              <div class="tb-drop-email">${user.email}</div>
            </div>
          </div>
          <div class="tb-dropdown-divider"></div>
          ${userChannel
            ? `<a href="channel.html?id=${userChannel.id}" class="tb-drop-item">
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
                Your Channel</a>
               <a href="studio.html" class="tb-drop-item">
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                Studio</a>
               <a href="upload.html" class="tb-drop-item">
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Upload Video</a>`
            : `<a href="create-channel.html" class="tb-drop-item">
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                Create Channel</a>`}
          <div class="tb-dropdown-divider"></div>
          <button class="tb-drop-item tb-drop-btn" onclick="VT.logout()">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Sign Out</button>
        </div>
      </div>
    ` : `
      <a href="login.html" class="tb-sign-in-btn">Sign In</a>
    `;

    const uploadBtn = user && getChannelByOwner(user.id) ? `
      <a href="upload.html" class="tb-upload-btn" title="Upload">
        <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      </a>
    ` : '';

    return `
      <div class="topbar-left">
        <button class="menu-btn" onclick="document.getElementById('sidebar')?.classList.toggle('collapsed');document.getElementById('main')?.classList.toggle('expanded')" title="Menu">
          <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
        </button>
        <a href="index.html" class="logo">
          <div class="logo-icon"><svg viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></div>
          <span class="logo-text">View<span>Tube</span></span>
        </a>
      </div>
      <div class="search-wrap">
        <input class="search-input" type="text" placeholder="Search videos, channels, topics..." id="searchInput" onkeydown="if(event.key==='Enter')VT.searchRedirect(this.value)">
        <button class="search-btn" onclick="VT.searchRedirect(document.getElementById('searchInput').value)">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        </button>
      </div>
      <div class="topbar-right">
        ${uploadBtn}
        <button class="icon-btn" title="Notifications">
          <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        </button>
        ${authSection}
      </div>
    `;
  }

  function toggleUserDropdown() {
    document.getElementById('tbDropdown')?.classList.toggle('open');
  }

  function searchRedirect(q) {
    if (q && q.trim()) window.location.href = `index.html?q=${encodeURIComponent(q.trim())}`;
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', e => {
    const menu = document.getElementById('tbUserMenu');
    if (menu && !menu.contains(e.target)) {
      document.getElementById('tbDropdown')?.classList.remove('open');
    }
  });

  // ── SHARED TOPBAR STYLES ─────────────────────────────────────
  function injectTopbarStyles() {
    if (document.getElementById('vt-topbar-styles')) return;
    const s = document.createElement('style');
    s.id = 'vt-topbar-styles';
    s.textContent = `
      .tb-upload-btn { display:flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:8px; color:var(--text2); text-decoration:none; transition:.2s; }
      .tb-upload-btn:hover { background:var(--surface); color:var(--text); }
      .tb-sign-in-btn { background:var(--accent); color:white; text-decoration:none; padding:7px 18px; border-radius:20px; font-size:13px; font-weight:600; transition:.2s; white-space:nowrap; }
      .tb-sign-in-btn:hover { background:var(--accent2); }
      .tb-user-menu { position:relative; }
      .tb-avatar-btn { width:36px; height:36px; border-radius:50%; border:2px solid var(--border); background:linear-gradient(135deg,var(--accent),var(--red,#ff4757)); cursor:pointer; overflow:hidden; display:flex; align-items:center; justify-content:center; font-weight:700; color:white; font-size:14px; transition:.2s; padding:0; }
      .tb-avatar-btn:hover { border-color:var(--accent); }
      .tb-avatar-btn img { width:100%; height:100%; object-fit:cover; }
      .tb-dropdown { position:absolute; top:calc(100% + 10px); right:0; width:240px; background:var(--bg2,#0f0f1a); border:1px solid var(--border); border-radius:14px; overflow:hidden; opacity:0; pointer-events:none; transform:translateY(-8px); transition:.2s; z-index:999; box-shadow:0 16px 40px rgba(0,0,0,0.6); }
      .tb-dropdown.open { opacity:1; pointer-events:all; transform:translateY(0); }
      .tb-dropdown-header { display:flex; align-items:center; gap:10px; padding:14px 16px; }
      .tb-drop-avatar { width:38px; height:38px; border-radius:50%; object-fit:cover; flex-shrink:0; }
      .tb-drop-name { font-weight:600; font-size:14px; color:var(--text); }
      .tb-drop-email { font-size:11px; color:var(--text3,#5a5a80); margin-top:1px; }
      .tb-dropdown-divider { height:1px; background:var(--border); margin:4px 0; }
      .tb-drop-item { display:flex; align-items:center; gap:10px; padding:10px 16px; font-size:13px; color:var(--text2); text-decoration:none; transition:.15s; cursor:pointer; width:100%; background:none; border:none; text-align:left; font-family:inherit; }
      .tb-drop-item:hover { background:var(--surface,#1a1a2e); color:var(--text); }
      .tb-drop-btn { color:var(--red,#ff4757) !important; }
    `;
    document.head.appendChild(s);
  }

  // ── PUBLIC API ────────────────────────────────────────────────
  return {
    // Data
    initSeedData,
    // Auth
    currentUser, register, login, logout, requireAuth,
    getUsers,
    // Channels
    getChannels, getChannel, getChannelByOwner, createChannel, updateChannel,
    // Videos
    getVideos, getAllVideos, getVideo, getChannelVideos, uploadVideo, deleteVideo,
    recordView,
    // Subs
    isSubscribed, toggleSubscribe, getUserSubs,
    // Likes
    hasLiked, hasDisliked, toggleLike, toggleDislike,
    // Comments
    getVideoComments, addComment, addReply,
    // Util
    badgeHTML, fmtSubs, timeAgo, uid,
    // Topbar
    renderTopbar, toggleUserDropdown, searchRedirect, injectTopbarStyles,
  };
})();


(() => {
  "use strict";

  const PROFILE_KEY = "spaceskribble_profile_v1";
  const AVATAR_KEY = "spaceskribble_avatar_v1";
  const SETTINGS_KEY = "spaceskribble_settings_v1";
  const DAILY_KEY = "spaceskribble_daily_v1";
  const MISSIONS_KEY = "spaceskribble_missions_v1";
  const GAME_STATS_KEY = "spaceskribble_game_stats_v1";
  const DEFAULT_AVATAR = "./default-avatar.svg";

  const $ = (id) => document.getElementById(id);

  // Database progress
  let serverProgress = {
    correct_answers: 0,
    xp: 0,
    completed_steps: 0,
    updated_at: null,
    loading: true,
    error: ""
  };

  const readJSON = (key, fallback) => {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  };

  let profile = readJSON(PROFILE_KEY, { name: "", xp: 0 });

  profile = {
    name:
      typeof profile.name === "string" && profile.name.trim()
        ? profile.name
        : localStorage.getItem("ss-name") || "Space Explorer",
    xp: Math.max(0, Number(profile.xp) || 0)
  };

  let settings = {
    language: "en",
    sound: localStorage.getItem("ss-muted") !== "1",
    animation: true,
    darkTheme: true,
    largeText: false,
    contrast: false,
    ...readJSON(SETTINGS_KEY, {})
  };

  let missions = readJSON(MISSIONS_KEY, {});
  let daily = readJSON(DAILY_KEY, {});

  function saveProfile() {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    localStorage.setItem("ss-name", profile.name);
  }

  function message(text) {
    const el =
      $("profileMessage") ||
      $("settingsMessage") ||
      $("dailyChallengeMessage");

    if (el) el.textContent = text;
  }

  // Find the login token saved by the authentication system.
  function getSavedUser() {
    const possibleKeys = [
      "spaceSkribbleUser",
      "spaceskribble_user",
      "ss-user"
    ];

    for (const key of possibleKeys) {
      try {
        const user = JSON.parse(localStorage.getItem(key) || "null");

        if (user && typeof user.token === "string" && user.token) {
          return user;
        }
      } catch {
        // Try the next storage key.
      }
    }

    return null;
  }

  // Fetch the logged-in user's progress from the database.
  async function loadServerProgress() {
    serverProgress.loading = true;
    serverProgress.error = "";
    renderLearning();

    const savedUser = getSavedUser();

    if (!savedUser) {
      serverProgress.loading = false;
      serverProgress.error = "Please log in to view your saved game progress.";
      renderLearning();
      return;
    }

    try {
      const response = await fetch(
        (window.SS_API_BASE || "").replace(/\/$/, "") + "/api/progress",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${savedUser.token}`
          }
        }
      );

      if (response.status === 401) {
        throw new Error("Your login session expired. Please log in again.");
      }

      if (!response.ok) {
        throw new Error(
          `Could not load progress (HTTP ${response.status}).`
        );
      }

      const result = await response.json();

      // auto-server.js returns { progress: {...} }.
      const progress = result.progress;

      if (!progress) {
        throw new Error("Progress data was not found.");
      }

      serverProgress.correct_answers =
        Number(progress.correct_answers) || 0;

      serverProgress.xp = Number(progress.xp) || 0;

      serverProgress.completed_steps =
        Number(progress.completed_steps) || 0;

      serverProgress.updated_at = progress.updated_at || null;
      serverProgress.error = "";
    } catch (error) {
      serverProgress.error =
        error.message || "Could not load database progress.";

      console.error("Progress loading failed:", error);
    } finally {
      serverProgress.loading = false;
      renderLearning();
    }
  }

  function renderServerProgress() {
    const correctElement = $("correctAnswersValue");
    const xpElement = $("serverXpValue");

    if (correctElement) {
      correctElement.textContent = serverProgress.correct_answers;
    }

    if (xpElement) {
      xpElement.textContent = `${serverProgress.xp} XP`;
    }
  }

  function avatarSource() {
    return localStorage.getItem(AVATAR_KEY) || DEFAULT_AVATAR;
  }

  function renderAvatar() {
    const src = avatarSource();

    ["avatarPreview", "navProfileAvatar"].forEach((id) => {
      const img = $(id);

      if (img) {
        img.src = src;

        img.onerror = () => {
          img.onerror = null;
          img.src = DEFAULT_AVATAR;
        };
      }
    });
  }

  function levelInfo() {
    const level = Math.floor(profile.xp / 100) + 1;

    return {
      level,
      progress: profile.xp % 100
    };
  }

  function renderBadges() {
    const badges = [
      { icon: "🚀", name: "First Launch", xp: 0 },
      { icon: "🪐", name: "Planet Explorer", xp: 100 },
      { icon: "🌟", name: "Star Seeker", xp: 250 },
      { icon: "🌌", name: "Galaxy Mind", xp: 500 },
      { icon: "🔭", name: "Sky Watcher", xp: 750 },
      { icon: "👨‍🚀", name: "Space Legend", xp: 1000 }
    ];

    const earned = badges.filter((badge) => profile.xp >= badge.xp);

    if ($("badgeCount")) {
      $("badgeCount").textContent = earned.length;
    }

    if ($("badgesGrid")) {
      $("badgesGrid").innerHTML = badges.map((badge) => {
        const unlocked = profile.xp >= badge.xp;

        return `
          <article class="profile-badge" style="
            padding:16px 8px;
            text-align:center;
            border:1px solid #344363;
            border-radius:12px;
            background:#192541;
            opacity:${unlocked ? "1" : ".5"}">
            <div style="font-size:28px">${badge.icon}</div>
            <strong style="display:block;margin:8px 0">
              ${badge.name}
            </strong>
            <small style="color:#a6b2ca">
              ${unlocked ? "Unlocked" : `${badge.xp} XP required`}
            </small>
          </article>`;
      }).join("");
    }
  }

  // Display actual database progress instead of fake percentages.
  function renderLearning() {
    const list = $("learningList");

    if (!list) return;

    if (serverProgress.loading) {
      list.innerHTML = `
        <p class="muted">Loading your saved game progress...</p>
      `;
      return;
    }

    if (serverProgress.error) {
      list.innerHTML = `
        <p class="muted">
          ${serverProgress.error}
        </p>
        <button type="button" id="retryProgressButton">
          Try Again
        </button>
      `;

      const retryButton = $("retryProgressButton");

      if (retryButton) {
        retryButton.addEventListener("click", loadServerProgress);
      }

      return;
    }

    list.innerHTML = `
      <article class="learning-progress-card" style="
        margin:14px 0;
        padding:16px;
        border:1px solid #344363;
        border-radius:12px;
        background:#192541">

        <div style="font-size:24px;margin-bottom:8px">🎯</div>

        <strong>Correct Answers</strong>

        <p style="font-size:1.5rem;margin:8px 0">
          ${serverProgress.correct_answers}
        </p>

        <p class="muted">
          Correct guesses recorded for your account.
        </p>
      </article>

      <article class="learning-progress-card" style="
        margin:14px 0;
        padding:16px;
        border:1px solid #344363;
        border-radius:12px;
        background:#192541">

        <div style="font-size:24px;margin-bottom:8px">⭐</div>

        <strong>Game XP Earned</strong>

        <p style="font-size:1.5rem;margin:8px 0">
          ${serverProgress.xp} XP
        </p>

        <p class="muted">
          XP saved in the database from correct guesses.
        </p>
      </article>

      <article class="learning-progress-card" style="
        margin:14px 0;
        padding:16px;
        border:1px solid #344363;
        border-radius:12px;
        background:#192541">

        <div style="font-size:24px;margin-bottom:8px">📚</div>

        <strong>Completed Learning Steps</strong>

        <p style="font-size:1.5rem;margin:8px 0">
          ${serverProgress.completed_steps}
        </p>

        <p class="muted">
          Completed steps saved in your account.
        </p>
      </article>
    `;

    renderServerProgress();
  }

  function renderProfile() {
    const { level, progress } = levelInfo();

    if ($("playerName")) {
      $("playerName").textContent = profile.name;
    }

    if ($("nameInput")) {
      $("nameInput").value = profile.name;
    }

    if ($("playerLevel")) {
      $("playerLevel").textContent =
        `Level ${level} · ${
          level === 1 ? "Cosmic Rookie" : "Space Explorer"
        }`;
    }

    if ($("levelValue")) {
      $("levelValue").textContent = level;
    }

    if ($("xpValue")) {
      $("xpValue").textContent = `${profile.xp} XP`;
    }

    if ($("xpLabel")) {
      $("xpLabel").textContent = `${progress} / 100 XP`;
    }

    if ($("xpProgress")) {
      $("xpProgress").style.width = `${progress}%`;
    }

    if ($("xpHint")) {
      $("xpHint").textContent =
        `${100 - progress} XP until next level.`;
    }

    if ($("missionsCompleted")) {
      const completed =
        Object.values(missions).filter(Boolean).length;

      $("missionsCompleted").textContent = completed;
    }

    renderBadges();
    renderLearning();
    renderMissions();
    renderDailyChallenge();
  }

  // Existing helper used by the game and profile rewards.
  window.SpaceSkribbleProfile = {
    addXP(amount, reason = "Game reward") {
      const points = Math.floor(Number(amount));

      if (!Number.isFinite(points) || points <= 0) return;

      profile.xp += points;
      saveProfile();
      renderProfile();

      window.dispatchEvent(
        new CustomEvent("spaceskribble:xp", {
          detail: {
            amount: points,
            total: profile.xp,
            reason
          }
        })
      );
    },

    getXP() {
      return profile.xp;
    },

    refreshServerProgress() {
      return loadServerProgress();
    }
  };

  // Save player name.
  const saveNameButton = $("saveName");

  if (saveNameButton) {
    saveNameButton.addEventListener("click", () => {
      const input = $("nameInput");
      const name = input?.value.trim().slice(0, 30) || "";

      if (!name) {
        message("Please enter a player name.");
        input?.focus();
        return;
      }

      profile.name = name;

      try {
        saveProfile();
        renderProfile();
        message("Player name saved.");
      } catch {
        message("Could not save your profile.");
      }
    });
  }

  // Avatar upload.
  const upload = $("avatarUpload");

  if (upload) {
    upload.addEventListener("change", () => {
      const file = upload.files?.[0];

      if (!file) return;

      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        message("Choose a JPG, PNG, or WebP image.");
        upload.value = "";
        return;
      }

      if (file.size > 2 * 1024 * 1024) {
        message("Image must be 2 MB or smaller.");
        upload.value = "";
        return;
      }

      const reader = new FileReader();

      reader.onload = () => {
        try {
          localStorage.setItem(AVATAR_KEY, reader.result);
          renderAvatar();
          message("Profile picture saved successfully.");
        } catch {
          message("Storage is full. Please choose a smaller image.");
        }
      };

      reader.onerror = () => {
        message("Could not read this image.");
      };

      reader.readAsDataURL(file);
    });
  }

  const removeAvatar = $("removeAvatar");

  if (removeAvatar) {
    removeAvatar.addEventListener("click", () => {
      localStorage.removeItem(AVATAR_KEY);
      renderAvatar();

      if (upload) upload.value = "";

      message("Default avatar restored.");
    });
  }

  // Missions and local XP rewards.
  const MISSION_LIST = [
    {
      id: "first_game",
      title: "Complete your first game",
      detail: "Earn 25 XP",
      reward: 25
    },
    {
      id: "explorer",
      title: "Reach 100 XP",
      detail: "Earn 20 bonus XP",
      reward: 20,
      requirement: 100
    },
    {
      id: "space_pro",
      title: "Reach 500 XP",
      detail: "Earn 50 bonus XP",
      reward: 50,
      requirement: 500
    }
  ];

  function renderMissions() {
    const list = $("missionsList");

    if (!list) return;

    list.innerHTML = MISSION_LIST.map((mission) => {
      const eligible = mission.id === "first_game"
        ? Number(readJSON(GAME_STATS_KEY, {}).games || 0) >= 1
        : profile.xp >= mission.requirement;

      const claimed = Boolean(missions[mission.id]);

      return `
        <article class="mission-item" style="
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          padding:14px;
          margin:10px 0;
          border:1px solid #344363;
          border-radius:12px">

          <div>
            <strong>${mission.title}</strong>
            <div style="color:#a6b2ca;font-size:.9em">
              ${mission.detail}
            </div>
            <small>
              ${claimed ? "Completed" : eligible ? "Ready to claim" : "In progress"}
            </small>
          </div>

          <button type="button"
            data-claim-mission="${mission.id}"
            ${!eligible || claimed ? "disabled" : ""}>
            ${claimed ? "Completed" : "Claim"}
          </button>
        </article>`;
    }).join("");
  }

  const missionsList = $("missionsList");

  if (missionsList) {
    missionsList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-claim-mission]");

      if (!button) return;

      const mission = MISSION_LIST.find(
        (item) => item.id === button.dataset.claimMission
      );

      if (!mission || missions[mission.id]) return;

      const eligible = mission.id === "first_game"
        ? Number(readJSON(GAME_STATS_KEY, {}).games || 0) >= 1
        : profile.xp >= mission.requirement;

      if (!eligible) return;

      missions[mission.id] = true;

      localStorage.setItem(
        MISSIONS_KEY,
        JSON.stringify(missions)
      );

      window.SpaceSkribbleProfile.addXP(
        mission.reward,
        "Mission: " + mission.title
      );

      message(`Mission completed! +${mission.reward} XP`);
      renderProfile();
    });
  }

  // Daily reward: once per local calendar day.
  function localDateKey() {
    const date = new Date();

    return `${date.getFullYear()}-${String(
      date.getMonth() + 1
    ).padStart(2, "0")}-${String(
      date.getDate()
    ).padStart(2, "0")}`;
  }

  function renderDailyChallenge() {
    const button = $("dailyChallengeButton");
    const text = $("dailyChallengeText");
    const today = localDateKey();
    const claimedToday = daily.date === today;

    if (text) {
      text.textContent = claimedToday
        ? "Today's challenge completed. Come back tomorrow!"
        : "Daily Space Challenge: claim your 10 XP reward.";
    }

    if (button) {
      button.disabled = claimedToday;
      button.textContent = claimedToday
        ? "Completed Today"
        : "Claim Daily Reward (+10 XP)";
    }

    if ($("dailyChallengeMessage") && claimedToday) {
      $("dailyChallengeMessage").textContent =
        "Daily reward already claimed today.";
    }
  }

  const dailyButton = $("dailyChallengeButton");

  if (dailyButton) {
    dailyButton.addEventListener("click", () => {
      const today = localDateKey();

      if (daily.date === today) {
        renderDailyChallenge();
        return;
      }

      daily = { date: today };

      localStorage.setItem(
        DAILY_KEY,
        JSON.stringify(daily)
      );

      window.SpaceSkribbleProfile.addXP(10, "Daily Challenge");

      if ($("dailyChallengeMessage")) {
        $("dailyChallengeMessage").textContent =
          "Daily challenge complete! +10 XP";
      }

      renderDailyChallenge();
    });
  }

  // Apply saved settings.
  function applyLanguage() {
    if (settings.language !== "bn") return;

    const translations = {
      "Profile": "প্রোফাইল",
      "Settings": "সেটিংস",
      "Player Name": "খেলোয়াড়ের নাম",
      "Save Name": "নাম সংরক্ষণ",
      "Upload Avatar": "অ্যাভাটার আপলোড",
      "Remove Avatar": "অ্যাভাটার সরান",
      "Badges": "ব্যাজ",
      "Missions": "মিশন",
      "Save Settings": "সেটিংস সংরক্ষণ",
      "Reset Progress": "প্রগ্রেস রিসেট",
      "Learning Progress": "শেখার অগ্রগতি"
    };

    document.querySelectorAll("h1,h2,h3,h4,label,button").forEach((el) => {
      if (!el.dataset.originalText) {
        el.dataset.originalText = el.textContent.trim();
      }

      const original = el.dataset.originalText;

      if (translations[original]) {
        el.textContent = translations[original];
      }
    });
  }

  function applySettings() {
    document.documentElement.lang =
      settings.language === "bn" ? "bn" : "en";

    document.body.classList.toggle(
      "light-theme",
      !settings.darkTheme
    );

    document.body.classList.toggle(
      "large-text",
      Boolean(settings.largeText)
    );

    document.body.classList.toggle(
      "high-contrast",
      Boolean(settings.contrast)
    );

    document.body.classList.toggle(
      "reduce-animations",
      !settings.animation
    );

    localStorage.setItem(
      "ss-muted",
      settings.sound ? "0" : "1"
    );

    const gameMuteButton = $("mute-btn");

    if (gameMuteButton) {
      gameMuteButton.textContent =
        settings.sound ? "🔊" : "🔇";
    }

    applyLanguage();
  }

  function loadSettingsIntoControls() {
    const mapping = {
      languageSetting: "language",
      soundSetting: "sound",
      animationSetting: "animation",
      darkThemeSetting: "darkTheme",
      largeTextSetting: "largeText",
      contrastSetting: "contrast"
    };

    for (const [id, key] of Object.entries(mapping)) {
      const el = $(id);

      if (!el) continue;

      if (el.type === "checkbox") {
        el.checked = Boolean(settings[key]);
      } else {
        el.value = settings[key];
      }

      el.addEventListener("change", () => {
        settings[key] = el.type === "checkbox"
          ? el.checked
          : el.value;

        if (key === "sound") {
          localStorage.setItem(
            "ss-muted",
            settings.sound ? "0" : "1"
          );
        }

        applySettings();
      });
    }
  }

  const saveSettingsButton = $("saveSettings");

  if (saveSettingsButton) {
    saveSettingsButton.addEventListener("click", () => {
      try {
        localStorage.setItem(
          SETTINGS_KEY,
          JSON.stringify(settings)
        );

        applySettings();

        if ($("settingsMessage")) {
          $("settingsMessage").textContent =
            "Settings saved successfully.";
        } else {
          message("Settings saved successfully.");
        }
      } catch {
        message("Could not save settings.");
      }
    });
  }

  // This resets local profile progress only, not database progress.
  const resetButton = $("resetProgress");

  if (resetButton) {
    resetButton.addEventListener("click", () => {
      if (!confirm(
        "Reset local XP, levels, badges, missions, and game progress? Database game progress will not be deleted."
      )) {
        return;
      }

      profile.xp = 0;
      missions = {};

      localStorage.removeItem(GAME_STATS_KEY);

      localStorage.setItem(
        MISSIONS_KEY,
        JSON.stringify(missions)
      );

      saveProfile();
      renderProfile();

      message(
        "Local progress reset. Database game progress was kept."
      );
    });
  }

  // Refresh local profile if another tab updates local storage.
  window.addEventListener("storage", (event) => {
    if (
      [
        PROFILE_KEY,
        AVATAR_KEY,
        MISSIONS_KEY,
        DAILY_KEY,
        GAME_STATS_KEY
      ].includes(event.key)
    ) {
      profile = readJSON(PROFILE_KEY, profile);
      missions = readJSON(MISSIONS_KEY, {});
      daily = readJSON(DAILY_KEY, {});

      renderAvatar();
      renderProfile();
    }

    if (event.key === "ss-muted") {
      settings.sound = event.newValue !== "1";

      const el = $("soundSetting");

      if (el) el.checked = settings.sound;
    }
  });

  // Initialize profile and fetch saved database progress.
  loadSettingsIntoControls();
  applySettings();
  renderAvatar();
  renderProfile();
  loadServerProgress();
})();

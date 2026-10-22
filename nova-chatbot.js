
/* =========================================================
   NOVA AI CHATBOT
   Always-visible robot + draggable launcher + chat panel
   ========================================================= */

(() => {
  "use strict";

  // 1. HTML ELEMENTS
  const widget = document.getElementById("nova-widget");

  const panel =
    document.getElementById("panel") ||
    document.getElementById("nova-panel");

  const openBtn =
    document.getElementById("open") ||
    document.getElementById("nova-launcher");

  const closeBtn =
    document.getElementById("close") ||
    document.getElementById("nova-close");

  const messages = document.getElementById("messages");
  const input = document.getElementById("input");
  const welcome = document.getElementById("welcome");
  const suggestions = document.getElementById("suggestions");
  const typing = document.getElementById("typing");
  const clearBtn = document.getElementById("clear");

  const chatForm =
    document.getElementById("chatForm") ||
    document.getElementById("nova-form");

  if (!widget || !panel || !openBtn) {
    console.error(
      "NOVA: Check HTML IDs: nova-widget, panel, and open."
    );
    return;
  }

  // 2. OPEN / CLOSE CHAT
  // Robot is NEVER hidden.

  function openChat() {
    panel.hidden = false;
    openBtn.hidden = false;

    if (input) {
      setTimeout(() => input.focus(), 50);
    }
  }

  function closeChat() {
    panel.hidden = true;
    openBtn.hidden = false;
  }

  function toggleChat() {
    if (panel.hidden) {
      openChat();
    } else {
      closeChat();
    }
  }

  openBtn.addEventListener("click", toggleChat);

  if (closeBtn) {
    closeBtn.addEventListener("click", closeChat);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      closeChat();
    }
  });

  // 3. CLEAR CHAT
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (messages) messages.replaceChildren();

      history.length = 0;

      if (welcome) welcome.hidden = false;
      if (suggestions) suggestions.hidden = false;
      if (typing) typing.hidden = true;

      if (input) {
        input.value = "";
        input.style.height = "auto";
      }
    });
  }

  // 4. ADD MESSAGE
  function addMessage(text, who) {
    if (!messages) return;

    const element = document.createElement("div");
    element.className = "message " + who;
    element.textContent = text;

    messages.appendChild(element);
    messages.scrollTop = messages.scrollHeight;
  }

  // 5. LOCAL DEMO REPLIES
  function localReply(question) {
    const text = question.toLowerCase();

    if (/hello|hi\b|hey|assalamu|salam/.test(text)) {
      return "Hello! 😊 I'm NOVA. How can I help you today?";
    }

    if (/what can you do|help|capabilit/.test(text)) {
      return "I can help explain topics, brainstorm project ideas, draft text, and guide you through coding. I'm currently running in demo mode.";
    }

    if (/black hole/.test(text)) {
      return "A black hole is a region of space where gravity is so strong that nothing, not even light, can escape from within its event horizon. 🌌";
    }

    if (/earth|planet|gravity/.test(text)) {
      return "Earth is our home planet. 🌍 Its average surface gravity is approximately 9.81 m/s².";
    }

    if (/cyber|security|malware|hacking/.test(text)) {
      return "Cybersecurity protects devices, networks, and data from digital threats. Start with networking, Linux, web security, and safe practice labs. 🔐";
    }

    if (/project|idea|brainstorm/.test(text)) {
      return "Project idea: Build a student study planner with a timetable, assignment tracker, reminders, and a dashboard. You could add an AI assistant too! 💡";
    }

    if (/html|css|javascript|code|program/.test(text)) {
      return "Let's solve your coding problem step by step. 💻 Tell me the programming language and share the code or error you're facing.";
    }

    if (/thank/.test(text)) {
      return "You're welcome! ✨ Ask me anything else.";
    }

    return "Thanks for your message! 😊 I'm NOVA. My live AI brain is offline right now, so I can only answer a few basic space questions. Try asking about black holes, Earth or gravity!";
  }

  // 6. SEND MESSAGE
  // NOVA asks the server (/api/nova), which talks to the real AI. The API key never
  // reaches the browser. If the server has no AI key, we fall back to the demo replies.
  let replyTimer = null;
  const history = [];

  async function askNova(question) {
    if (!window.SS || !window.SS.getUser()) return localReply(question);

    history.push({ role: "user", content: question });

    try {
      const response = await window.SS.api("/api/nova", {
        method: "POST",
        body: JSON.stringify({
          messages: history.slice(-10),
          lang: window.SSLang ? window.SSLang.get() : "en"
        })
      });

      if (response.status === 401) {
        window.SS.logout();
        return "";
      }

      const data = await response.json().catch(() => ({}));

      if (response.ok && data.reply) {
        history.push({ role: "assistant", content: data.reply });
        return data.reply;
      }
    } catch (error) {
      console.warn("NOVA server unreachable, using demo reply.", error);
    }

    history.pop();
    return localReply(question);
  }

  function sendMessage(value) {
    const question = (value || "").trim();
    if (!question) return;

    if (welcome) welcome.hidden = true;
    if (suggestions) suggestions.hidden = true;

    addMessage(question, "user");

    if (input) {
      input.value = "";
      input.style.height = "auto";
    }

    if (typing) typing.hidden = false;

    askNova(question).then((answer) => {
      if (typing) typing.hidden = true;
      if (answer) addMessage(answer, "bot");
    });
  }

  // 7. FORM + ENTER KEY
  if (chatForm && input) {
    chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      sendMessage(input.value);
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();

        if (typeof chatForm.requestSubmit === "function") {
          chatForm.requestSubmit();
        } else {
          sendMessage(input.value);
        }
      }
    });

    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height =
        Math.min(input.scrollHeight, 100) + "px";
    });
  }

  // 8. SUGGESTION BUTTONS
  document.querySelectorAll(".prompt").forEach((button) => {
    button.addEventListener("click", () => {
      const question =
        button.dataset.question ||
        button.dataset.prompt ||
        button.textContent;

      sendMessage(question);
    });
  });

  // 9. DRAG ROBOT WITHOUT OPENING CHAT
  const launcher =
    widget.querySelector(".robot-launcher") || openBtn;

  let pointerDown = false;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;
  let activePointerId = null;
  let suppressNextClick = false;

  const DRAG_DISTANCE = 8;

  const clamp = (value, min, max) =>
    Math.max(min, Math.min(value, max));

  launcher.style.touchAction = "none";
  launcher.style.userSelect = "none";
  launcher.style.webkitUserSelect = "none";

  launcher.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    pointerDown = true;
    dragging = false;
    activePointerId = event.pointerId;

    startX = event.clientX;
    startY = event.clientY;

    const rect = widget.getBoundingClientRect();

    initialLeft = rect.left;
    initialTop = rect.top;

    // Convert fixed-position widget to explicit coordinates.
    widget.style.position = "fixed";
    widget.style.left = rect.left + "px";
    widget.style.top = rect.top + "px";
    widget.style.right = "auto";
    widget.style.bottom = "auto";

    try {
      launcher.setPointerCapture(event.pointerId);
    } catch (_) {}
  });

  launcher.addEventListener("pointermove", (event) => {
    if (!pointerDown || event.pointerId !== activePointerId) {
      return;
    }

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    if (
      !dragging &&
      (
        Math.abs(deltaX) > DRAG_DISTANCE ||
        Math.abs(deltaY) > DRAG_DISTANCE
      )
    ) {
      dragging = true;
    }

    if (!dragging) return;

    event.preventDefault();

    const maxLeft = Math.max(
      0,
      window.innerWidth - widget.offsetWidth
    );

    const maxTop = Math.max(
      0,
      window.innerHeight - widget.offsetHeight
    );

    widget.style.left =
      clamp(initialLeft + deltaX, 0, maxLeft) + "px";

    widget.style.top =
      clamp(initialTop + deltaY, 0, maxTop) + "px";
  });

  function finishPointer(event) {
    if (!pointerDown || event.pointerId !== activePointerId) {
      return;
    }

    if (dragging) {
      suppressNextClick = true;

      // Reset after the browser's synthetic click event.
      setTimeout(() => {
        suppressNextClick = false;
      }, 400);
    }

    pointerDown = false;
    dragging = false;
    activePointerId = null;
  }

  launcher.addEventListener("pointerup", finishPointer);
  launcher.addEventListener("pointercancel", finishPointer);

  // Prevent a drag from accidentally opening/closing the chat.
  launcher.addEventListener(
    "click",
    (event) => {
      if (suppressNextClick) {
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressNextClick = false;
      }
    },
    true
  );

  // 10. KEEP ROBOT WITHIN THE SCREEN
  window.addEventListener("resize", () => {
    const rect = widget.getBoundingClientRect();

    const maxLeft = Math.max(
      0,
      window.innerWidth - widget.offsetWidth
    );

    const maxTop = Math.max(
      0,
      window.innerHeight - widget.offsetHeight
    );

    if (widget.style.left) {
      widget.style.left =
        clamp(rect.left, 0, maxLeft) + "px";
    }

    if (widget.style.top) {
      widget.style.top =
        clamp(rect.top, 0, maxTop) + "px";
    }
  });

  // Initial state: panel closed, robot visible.
  panel.hidden = true;
  openBtn.hidden = false;

  console.log("NOVA initialized successfully.");
})();

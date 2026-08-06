document.addEventListener("DOMContentLoaded", () => {
  const BACKEND_URL = window.location.origin; // Dynamically resolve backend host

  // Authentication Key State
  let adminSecretKey = localStorage.getItem("bean_admin_secret") || "";

  // Core DOM Elements
  const authGate = document.getElementById("auth-gate");
  const authForm = document.getElementById("auth-form");
  const secretInput = document.getElementById("admin-secret-input");
  const authError = document.getElementById("auth-error");
  
  const adminPanel = document.getElementById("admin-panel");
  const logoutButton = document.getElementById("logout-button");
  const menuItems = document.querySelectorAll(".menu-item");
  const tabViews = document.querySelectorAll(".tab-view");

  // Stories Module DOM Elements
  const storiesPendingBadge = document.getElementById("stories-pending-badge");
  const storiesApprovedBadge = document.getElementById("stories-approved-badge");
  const storiesSubTabs = document.querySelectorAll(".sub-tab");
  const storiesGrid = document.getElementById("stories-grid");

  // State Management
  let activeTab = "stories";
  let activeStoriesSubTab = "pending";

  // Quiz Analytics State Management
  let currentParticipantsPage = 1;
  let participantsSearch = "";
  let allParticipantsList = [];
  let searchDebounceTimeout;

  // Escape HTML helper to prevent XSS
  const escapeHtml = (str) => {
    if (!str) return "";
    return str.replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  // ==========================================================================
  // AUTHENTICATION CONTROLLER (GATEKEEPER)
  // ==========================================================================
  const checkStoredAuth = async () => {
    if (adminSecretKey) {
      const isValid = await validateSecretKey(adminSecretKey);
      if (isValid) {
        openDashboard();
      } else {
        localStorage.removeItem("bean_admin_secret");
        adminSecretKey = "";
        showAuthGate();
      }
    } else {
      showAuthGate();
    }
  };

  const validateSecretKey = async (key) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/stories/admin/all?limit=1`, {
        headers: {
          "x-admin-key": key
        }
      });
      return response.ok;
    } catch (err) {
      console.error("Auth validation failed due to network error:", err);
      return false;
    }
  };

  const showAuthGate = () => {
    authGate.style.display = "flex";
    adminPanel.style.display = "none";
    secretInput.value = "";
    secretInput.focus();
  };

  const openDashboard = () => {
    authGate.style.display = "none";
    adminPanel.style.display = "flex";
    
    // Initialize Dashboard data
    loadModuleData(activeTab);
    updateStatsBadges();
  };

  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const enteredKey = secretInput.value.trim();
    authError.style.display = "none";

    const isValid = await validateSecretKey(enteredKey);
    if (isValid) {
      adminSecretKey = enteredKey;
      localStorage.setItem("bean_admin_secret", enteredKey);
      openDashboard();
    } else {
      authError.style.display = "block";
      authError.textContent = "Invalid Access Key. Authorization Denied.";
      secretInput.focus();
    }
  });

  logoutButton.addEventListener("click", () => {
    localStorage.removeItem("bean_admin_secret");
    adminSecretKey = "";
    showAuthGate();
  });

  // ==========================================================================
  // SINGLE PAGE APPLICATION (SPA) TAB ROUTER
  // ==========================================================================
  menuItems.forEach(item => {
    item.addEventListener("click", () => {
      const targetTab = item.getAttribute("data-tab");
      
      // Update sidebar active menu style
      menuItems.forEach(i => i.classList.remove("active"));
      item.classList.add("active");
      
      // Update viewport visibility
      tabViews.forEach(view => view.classList.remove("active"));
      document.getElementById(`tab-${targetTab}`).classList.add("active");
      
      activeTab = targetTab;
      loadModuleData(targetTab);
    });
  });

  const loadModuleData = (tabName) => {
    if (tabName === "stories") {
      loadStories();
    } else if (tabName === "quiz") {
      loadAnalytics(true);
    }
  };

  // ==========================================================================
  // STORIES MODULE CONTROLLER (MODERATION BOARD)
  // ==========================================================================
  
  // Stories subtabs listener
  storiesSubTabs.forEach(subtab => {
    subtab.addEventListener("click", () => {
      storiesSubTabs.forEach(s => s.classList.remove("active"));
      subtab.classList.add("active");
      
      activeStoriesSubTab = subtab.getAttribute("data-subtab");
      loadStories();
    });
  });

  // Helper colors mapping
  const getBeanBadgeColor = (type) => {
    const colors = {
      coffee: '#A67C52',
      chilli: '#D32F2F',
      vanilla: '#E8D5A3',
      jelly: '#EC407A',
      green: '#43A047'
    };
    return colors[type] || '#A67C52';
  };

  const getPrimaryBeanKey = (archetypeKey) => {
    if (!archetypeKey) return "";
    return archetypeKey.split("_")[0];
  };

  const formatArchetype = (winningArchetype, resultType) => {
    if (!winningArchetype) return "INCOMPLETE";
    
    const beanNames = {
      coffee: "Coffee Bean",
      chilli: "Chilli Bean",
      vanilla: "Vanilla Bean",
      jelly: "Jelly Bean",
      green: "Green Bean"
    };

    if (winningArchetype.includes("_")) {
      const [primary, secondary] = winningArchetype.split("_");
      const primaryName = beanNames[primary] || primary;
      const secondaryName = beanNames[secondary] || secondary;
      
      const cleanPrimary = primaryName.replace(" Bean", "");
      const cleanSecondary = secondaryName.replace(" Bean", "");

      if (resultType === "true_blend") {
        return `${cleanPrimary} & ${cleanSecondary} True Blend`;
      } else {
        return `${cleanPrimary} & ${cleanSecondary} Dual Blend`;
      }
    }

    const displayName = beanNames[winningArchetype] || `${winningArchetype} Bean`;
    if (resultType === "dominant") {
      return `${displayName} (Dominant)`;
    } else if (resultType === "single") {
      return `${displayName} (Single)`;
    }
    return displayName;
  };

  // Update pending, approved, and rejected count stats badges
  const updateStatsBadges = async () => {
    if (!adminSecretKey) return;
    try {
      const headers = { "x-admin-key": adminSecretKey };

      // Pending count
      const resPending = await fetch(`${BACKEND_URL}/api/stories/admin/all?status=pending&limit=1`, {
        headers: headers
      });
      if (resPending.ok) {
        const data = await resPending.json();
        storiesPendingBadge.textContent = data.total;
        document.getElementById("badge-pending-count").textContent = data.total;
      }
      
      // Approved count
      const resApproved = await fetch(`${BACKEND_URL}/api/stories/admin/all?status=approved&limit=1`, {
        headers: headers
      });
      if (resApproved.ok) {
        const data = await resApproved.json();
        storiesApprovedBadge.textContent = data.total;
        document.getElementById("badge-approved-count").textContent = data.total;
      }

      // Rejected count
      const resRejected = await fetch(`${BACKEND_URL}/api/stories/admin/all?status=rejected&limit=1`, {
        headers: headers
      });
      if (resRejected.ok) {
        const data = await resRejected.json();
        document.getElementById("badge-rejected-count").textContent = data.total;
      }
    } catch (err) {
      console.warn("Could not retrieve statistics counts", err);
    }
  };

  const loadStories = async () => {
    storiesGrid.innerHTML = `
      <div class="loading-state">
        <div class="skeleton-loader">
          <div class="skeleton-bar"></div>
          <div class="skeleton-bar"></div>
          <div class="skeleton-bar"></div>
        </div>
      </div>
    `;
    
    try {
      const response = await fetch(`${BACKEND_URL}/api/stories/admin/all?status=${activeStoriesSubTab}&limit=50`, {
        headers: {
          "x-admin-key": adminSecretKey
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          logoutButton.click();
          return;
        }
        storiesGrid.innerHTML = `<div class="error-state"><svg class="error-icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg><p>Failed to fetch stories (HTTP ${response.status})</p><button type="button" class="retry-btn" onclick="window.location.reload()">Retry</button></div>`;
        return;
      }

      const data = await response.json();
      const stories = data.stories;
      
      if (!stories || stories.length === 0) {
        storiesGrid.innerHTML = `
          <div class="empty-state">
            <svg class="empty-icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
            <h3>No Stories Found</h3>
            <p>There are currently no stories in the "${activeStoriesSubTab}" review status.</p>
          </div>
        `;
        return;
      }

      storiesGrid.innerHTML = ""; // Clear loader

      stories.forEach(story => {
        const beanColor = getBeanBadgeColor(story.beanType);
        const card = document.createElement("div");
        card.className = "admin-story-card";
        card.setAttribute("style", `--bean-accent: ${beanColor};`);
        card.setAttribute("data-id", story._id);

        // Date layout
        const dateStr = new Date(story.createdAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric"
        });

        // Media Slider Markup
        let mediaMarkup = "";
        const hasImages = story.media.images && story.media.images.length > 0;
        const hasVideo = !!story.media.video;

        mediaMarkup += `<div class="card-media-section">
          <div class="media-section-label">MEDIA ATTACHMENTS</div>`;

        if (hasImages || hasVideo) {
          mediaMarkup += `<div class="card-media-gallery">`;
          if (hasImages) {
            mediaMarkup += `
              <div class="card-image-slider">
                ${story.media.images.map(img => `<img src="${img}" alt="Wearer style" onclick="window.open('${img}', '_blank')">`).join("")}
              </div>
            `;
          }
          if (hasVideo) {
            mediaMarkup += `
              <div class="card-video-player">
                <video src="${story.media.video}" controls muted playsinline></video>
              </div>
            `;
          }
          mediaMarkup += `</div>`;
        } else {
          mediaMarkup += `
            <div class="no-media-placeholder">
              <svg class="paperclip-icon" viewBox="0 0 24 24"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V6H9v9.5c0 2.48 2.02 4.5 4.5 4.5s4.5-2.02 4.5-4.5V5a4 4 0 0 0-8 0v12.5c0 3.59 2.91 6.5 6.5 6.5s6.5-2.91 6.5-6.5V6h-1.5z"/></svg>
              <span>No media attached</span>
            </div>
          `;
        }
        mediaMarkup += `</div>`;

        // Action Buttons Markup (Only show review options in pending review)
        let actionsMarkup = "";
        if (story.status === "pending") {
          actionsMarkup = `
            <div class="card-action-bar">
              <button type="button" class="card-btn approve" data-action="approve">APPROVE</button>
              <button type="button" class="card-btn reject" data-action="reject">REJECT</button>
            </div>
          `;
        } else if (story.status === "approved") {
          actionsMarkup = `
            <div class="card-action-bar">
              <button type="button" class="card-btn reject" data-action="reject">MOVE TO REJECTED</button>
            </div>
          `;
        } else if (story.status === "rejected") {
          actionsMarkup = `
            <div class="card-action-bar">
              <button type="button" class="card-btn approve" data-action="approve">RESTORE & APPROVE</button>
            </div>
          `;
        }

        // Instagram handle fallback
        const handleLabel = story.handle ? `<span class="card-handle-badge">@${story.handle}</span>` : `<span class="card-handle-badge text-muted">No Handle</span>`;

        // Story body text truncation check
        const needsTruncate = story.story && story.story.length > 180;
        const storyBodyMarkup = `
          <div class="card-story-body" id="story-body-${story._id}">"${story.story}"</div>
          ${needsTruncate ? `<button type="button" class="read-more-toggle-btn" data-story-id="${story._id}">Read more</button>` : ""}
        `;

        card.innerHTML = `
          <div class="card-header-wrapper">
            <div class="card-avatar">
              ${story.media.images && story.media.images.length > 0 ? `
                <img src="${story.media.images[0]}" alt="${story.name}">
              ` : `
                <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
              `}
            </div>
            <div class="card-title-meta">
              <span class="card-user-name" title="${story.name}">${story.name}</span>
              <div class="card-user-meta">
                ${handleLabel}
                <span>•</span>
                <span class="card-bean-badge">${story.beanType} Bean</span>
              </div>
            </div>
            <div class="card-timestamp">${dateStr}</div>
          </div>
          
          ${storyBodyMarkup}
          ${mediaMarkup}
          ${actionsMarkup}
        `;

        storiesGrid.appendChild(card);

        // Bind Read More button toggle
        if (needsTruncate) {
          const readMoreBtn = card.querySelector(`.read-more-toggle-btn[data-story-id="${story._id}"]`);
          const bodyEl = card.querySelector(`#story-body-${story._id}`);
          if (readMoreBtn && bodyEl) {
            readMoreBtn.addEventListener("click", () => {
              bodyEl.classList.toggle("expanded");
              if (bodyEl.classList.contains("expanded")) {
                readMoreBtn.textContent = "Read less";
              } else {
                readMoreBtn.textContent = "Read more";
              }
            });
          }
        }

        // Bind Action Button Click Events
        card.querySelectorAll(".card-btn").forEach(btn => {
          btn.addEventListener("click", async (e) => {
            const action = btn.getAttribute("data-action");
            const storyId = story._id;
            await moderateStory(storyId, action, card);
          });
        });
      });

    } catch (err) {
      console.error(err);
      storiesGrid.innerHTML = '<div class="error-state"><svg class="error-icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg><p>Error connecting to server. Please try again.</p><button type="button" class="retry-btn" onclick="window.location.reload()">Retry</button></div>';
    }
  };

  const moderateStory = async (storyId, action, cardElement) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/stories/admin/${storyId}/review`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminSecretKey
        },
        body: JSON.stringify({ action })
      });

      if (response.ok) {
        // Play smooth fade out transition
        cardElement.classList.add("fading-out");
        setTimeout(() => {
          cardElement.remove();
          updateStatsBadges();
          
          // If no cards left in list, trigger reload to show empty state
          if (storiesGrid.children.length === 0) {
            loadStories();
          }
        }, 250);
      } else {
        const result = await response.json();
        alert(result.error || "Failed to moderate story.");
      }
    } catch (err) {
      console.error(err);
      alert("Error connecting to server to save moderation review.");
    }
  };

  // ==========================================================================
  // QUIZ ANALYTICS MODULE CONTROLLER
  // ==========================================================================
  
  const loadAnalytics = async (clearList = true) => {
    const funnelContainer = document.getElementById("funnel-container");
    const outcomesList = document.getElementById("outcomes-list");
    const donutSvg = document.getElementById("donut-chart");
    const tbody = document.getElementById("participants-tbody");
    const loadMoreBtn = document.getElementById("load-more-participants-btn");
    
    if (clearList) {
      currentParticipantsPage = 1;
      allParticipantsList = [];
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 48px;">
            <div class="skeleton-loader">
              <div class="skeleton-bar"></div>
              <div class="skeleton-bar"></div>
              <div class="skeleton-bar"></div>
            </div>
          </td>
        </tr>
      `;
      funnelContainer.innerHTML = `
        <div class="skeleton-loader">
          <div class="skeleton-bar"></div>
          <div class="skeleton-bar"></div>
          <div class="skeleton-bar"></div>
        </div>
      `;
      outcomesList.innerHTML = `
        <div class="skeleton-loader">
          <div class="skeleton-bar"></div>
          <div class="skeleton-bar"></div>
          <div class="skeleton-bar"></div>
        </div>
      `;
      donutSvg.innerHTML = `<circle cx="50" cy="50" r="25" fill="transparent" stroke="rgba(255,255,255,0.03)" stroke-width="12" />`;
      loadMoreBtn.style.display = "none";
    }

    try {
      // NOTE: Using /api/quiz/admin/analytics as it is the registered backend path
      const response = await fetch(`${BACKEND_URL}/api/quiz/admin/analytics?page=${currentParticipantsPage}&limit=20&search=${encodeURIComponent(participantsSearch)}`, {
        headers: {
          "x-admin-key": adminSecretKey
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          logoutButton.click();
          return;
        }
        showAnalyticsError();
        return;
      }

      const data = await response.json();
      
      // Update top metrics
      document.getElementById("quiz-total-views").textContent = data.totalTraffic ?? 0;
      document.getElementById("quiz-link-clicks").textContent = data.referralClicks ?? 0;
      document.getElementById("quiz-completions").textContent = data.completedCount ?? 0;
      document.getElementById("donut-total-completions").textContent = data.completedCount ?? 0;

      // Circular Completion Progress Ring
      const rateVal = parseFloat(data.completionRate) || 0;
      const ringCircumference = 150.8; // 2 * pi * 24 (radius is 24)
      const ringOffset = ringCircumference - (ringCircumference * (rateVal / 100));
      const progressRingEl = document.getElementById("completion-progress-ring");
      if (progressRingEl) {
        progressRingEl.style.strokeDashoffset = ringOffset;
      }
      document.getElementById("quiz-completion-rate").textContent = `${rateVal.toFixed(1)}%`;

      // 1. PARTICIPATION FUNNEL RENDERING
      funnelContainer.innerHTML = "";
      const stepLabels = [
        "Start / Session Created",
        "Question 1 Completed",
        "Question 2 Completed",
        "Question 3 Completed",
        "Question 4 Completed",
        "Question 5 Completed",
        "Question 6 Completed",
        "Question 7 Completed",
        "Question 8 Completed",
        "Results Screen (Completed)"
      ];
      
      const maxUsers = data.funnel[0] || 0;
      for (let i = 0; i < 10; i++) {
        const count = data.funnel[i] || 0;
        const pct = maxUsers > 0 ? (count / maxUsers) * 100 : 0;
        
        const row = document.createElement("div");
        row.className = "funnel-step-row";
        const taperPct = 100 - i * 3;
        row.style.maxWidth = `${taperPct}%`;
        
        row.innerHTML = `
          <span class="funnel-step-label" title="${stepLabels[i]}">${stepLabels[i]}</span>
          <div class="funnel-step-bar-wrapper">
            <div class="funnel-step-bar-fill" style="width: ${pct}%;"></div>
          </div>
          <span class="funnel-step-value">${count} users (${pct.toFixed(1)}%)</span>
        `;
        funnelContainer.appendChild(row);
      }

      // 2. BEAN TYPE OUTCOMES RENDERING
      donutSvg.innerHTML = "";
      const totalCompletions = Object.values(data.archetypeDistribution).reduce((a, b) => a + b, 0);
      
      if (totalCompletions === 0) {
        donutSvg.innerHTML = `<circle cx="50" cy="50" r="25" fill="transparent" stroke="rgba(255,255,255,0.06)" stroke-width="12" />`;
      } else {
        // Aggregate by Primary Bean for clean 5-segment Donut Chart
        const primaryBeanCounts = {
          coffee: 0,
          chilli: 0,
          vanilla: 0,
          jelly: 0,
          green: 0
        };
        
        Object.entries(data.archetypeDistribution).forEach(([archetype, count]) => {
          const primaryKey = getPrimaryBeanKey(archetype);
          if (primaryBeanCounts[primaryKey] !== undefined) {
            primaryBeanCounts[primaryKey] += count;
          }
        });

        const donutCircumference = 157.08; // 2 * pi * 25
        let cumulativeVal = 0;
        
        Object.entries(primaryBeanCounts).forEach(([bean, count]) => {
          if (count === 0) return;
          const pct = count / totalCompletions;
          const segmentLength = pct * donutCircumference;
          const segmentOffset = -cumulativeVal;
          cumulativeVal += segmentLength;
          const color = getBeanBadgeColor(bean);
          
          donutSvg.innerHTML += `
            <circle cx="50" cy="50" r="25" fill="transparent" 
              stroke="${color}" stroke-width="12" 
              stroke-dasharray="${segmentLength} ${donutCircumference}" 
              stroke-dashoffset="${segmentOffset}" 
              transform="rotate(-95 50 50)" 
              style="transition: stroke-dashoffset 0.5s ease;" />
          `;
        });
      }

      // Ranked List
      outcomesList.innerHTML = "";
      if (data.detailedOutcomes && data.detailedOutcomes.length > 0) {
        data.detailedOutcomes.forEach((item) => {
          const pct = totalCompletions > 0 ? (item.count / totalCompletions) * 100 : 0;
          const primaryBean = getPrimaryBeanKey(item.winningArchetype);
          const color = getBeanBadgeColor(primaryBean);
          const friendlyName = formatArchetype(item.winningArchetype, item.resultType);
          
          const li = document.createElement("li");
          li.className = "outcome-list-item";
          li.innerHTML = `
            <span class="outcome-dot" style="background-color: ${color};"></span>
            <span class="outcome-name">${friendlyName}</span>
            <div class="outcome-percentage-bar">
              <div class="outcome-percentage-fill" style="width: ${pct}%; background-color: ${color};"></div>
            </div>
            <span class="outcome-count">${item.count}</span>
          `;
          outcomesList.appendChild(li);
        });
      } else {
        // Fallback to basic distribution if detailedOutcomes is somehow not returned
        const sortedOutcomes = Object.entries(data.archetypeDistribution)
          .sort((a, b) => b[1] - a[1]);
        
        sortedOutcomes.forEach(([bean, count]) => {
          const pct = totalCompletions > 0 ? (count / totalCompletions) * 100 : 0;
          const primaryBean = getPrimaryBeanKey(bean);
          const color = getBeanBadgeColor(primaryBean);
          const friendlyName = formatArchetype(bean, null);
          
          const li = document.createElement("li");
          li.className = "outcome-list-item";
          li.innerHTML = `
            <span class="outcome-dot" style="background-color: ${color};"></span>
            <span class="outcome-name">${friendlyName}</span>
            <div class="outcome-percentage-bar">
              <div class="outcome-percentage-fill" style="width: ${pct}%; background-color: ${color};"></div>
            </div>
            <span class="outcome-count">${count}</span>
          `;
          outcomesList.appendChild(li);
        });
      }

      // 3. PARTICIPANTS TABLE
      if (clearList) {
        tbody.innerHTML = "";
      }
      
      const responseParticipants = data.participants;
      if (responseParticipants.length === 0 && allParticipantsList.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 48px;">
              No participants found matching the query.
            </td>
          </tr>
        `;
      } else {
        responseParticipants.forEach(p => {
          allParticipantsList.push(p);
          const tr = document.createElement("tr");
          
          const primaryBean = getPrimaryBeanKey(p.winningArchetype);
          const beanColor = getBeanBadgeColor(primaryBean);
          const friendlyMatchName = formatArchetype(p.winningArchetype, p.resultType);
          
          const matchBadge = p.winningArchetype 
            ? `<span class="winning-match-badge" style="background-color: ${beanColor}15; color: ${beanColor}; border: 1px solid ${beanColor}30;">${friendlyMatchName}</span>`
            : `<span class="winning-match-badge" style="background-color: rgba(255,255,255,0.03); color: var(--text-muted); border: 1px solid var(--border);">INCOMPLETE</span>`;
          
          const furthestMarkup = p.isCompleted 
            ? `<span class="furthest-step-completed">
                 <svg class="checkmark-icon" viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
                 Completed (8/8)
               </span>`
            : `<span class="furthest-step-pending">Step ${Math.min(p.furthestStep || 0, 8)}/8</span>`;
          
          const lastActDate = new Date(p.updatedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
          });
          
          tr.innerHTML = `
            <td style="font-weight: 600;">${escapeHtml(p.name)}</td>
            <td style="color: var(--text-muted);">${escapeHtml(p.email)}</td>
            <td>${furthestMarkup}</td>
            <td>${matchBadge}</td>
            <td style="color: var(--text-muted);">${lastActDate}</td>
          `;
          tbody.appendChild(tr);
        });
      }

      // Show pagination load more button if there are more pages
      const hasMore = currentParticipantsPage < data.pagination.pages;
      loadMoreBtn.style.display = hasMore ? "block" : "none";

    } catch (err) {
      console.error(err);
      showAnalyticsError();
    }
  };

  const showAnalyticsError = () => {
    const funnelContainer = document.getElementById("funnel-container");
    const outcomesList = document.getElementById("outcomes-list");
    const tbody = document.getElementById("participants-tbody");
    
    const errMarkup = `
      <div class="error-state">
        <svg class="error-icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
        <p>Error loading analytics data. Please check connection and try again.</p>
        <button type="button" class="retry-btn" id="retry-analytics-btn">Retry</button>
      </div>
    `;
    
    funnelContainer.innerHTML = errMarkup;
    outcomesList.innerHTML = "";
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center;">Error loading participants.</td></tr>`;
    
    // Bind retry
    document.getElementById("retry-analytics-btn")?.addEventListener("click", () => {
      loadAnalytics(true);
    });
  };

  // ==========================================================================
  // EVENT LISTENERS & INITS FOR QUIZ MODULE
  // ==========================================================================
  
  // Search input debouncer
  const searchInput = document.getElementById("participants-search");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      clearTimeout(searchDebounceTimeout);
      participantsSearch = e.target.value;
      searchDebounceTimeout = setTimeout(() => {
        loadAnalytics(true);
      }, 400);
    });
  }

  // Load more button click
  const loadMoreBtn = document.getElementById("load-more-participants-btn");
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", () => {
      currentParticipantsPage++;
      loadAnalytics(false);
    });
  }

  // Run Check Auth on Load
  checkStoredAuth();
});

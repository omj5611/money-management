const STORAGE_KEY = "money-management-state-v1";
const CATEGORY_CLEAR_KEY = "money-management-categories-cleared-20260601";

const today = new Date();
const periodKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

const defaultState = {
  accounts: [
    { id: "account_001", name: "생활비통장", institution: "카카오뱅크", accountType: "bank", lastFourDigits: "1234", isDefault: true, color: "#ffd60a", memo: "고정지출 기본 출금계좌", isActive: true },
    { id: "account_002", name: "월급통장", institution: "국민은행", accountType: "bank", lastFourDigits: "5611", isDefault: false, color: "#30d158", memo: "", isActive: true },
    { id: "account_003", name: "현대카드", institution: "현대카드", accountType: "card", lastFourDigits: "0910", isDefault: false, color: "#0a84ff", memo: "", isActive: true }
  ],
  categories: [],
  fixedExpenses: [
    { id: "fixed_001", name: "청년적금", amount: 300000, categoryId: "", type: "saving", withdrawalAccountId: "account_002", toAccount: "신한 적금통장", transferType: "auto", paymentDay: 10, cycle: "monthly", startDate: `${today.getFullYear()}-01-10`, maturityDate: `${today.getFullYear() + 1}-01-10`, autoComplete: false, memo: "매월 자동이체" },
    { id: "fixed_002", name: "월세", amount: 500000, categoryId: "", type: "expense", withdrawalAccountId: "account_001", toAccount: "집주인 계좌", transferType: "manual", paymentDay: 5, cycle: "monthly", startDate: `${today.getFullYear()}-01-05`, maturityDate: "", autoComplete: false, memo: "" },
    { id: "fixed_003", name: "통신비", amount: 69000, categoryId: "", type: "expense", withdrawalAccountId: "account_003", toAccount: "통신사", transferType: "auto", paymentDay: 25, cycle: "monthly", startDate: `${today.getFullYear()}-01-25`, maturityDate: "", autoComplete: false, memo: "" }
  ],
  fixedLogs: [
    { id: "log_001", fixedExpenseId: "fixed_002", periodKey, status: "completed", scheduledDate: scheduledDate(5), completedDate: scheduledDate(5), actualAmount: 500000, memo: "" }
  ],
  fixedStatCategories: {
    saving: [],
    expense: [],
    subscription: [],
    emergency: []
  },
  expenses: [
    { id: "expense_001", name: "점심", amount: 12000, categoryId: "", type: "expense", date: isoDate(today), paymentMethod: "card", accountOrCard: "현대카드", memo: "" },
    { id: "expense_002", name: "비상금 추가", amount: 100000, categoryId: "", type: "saving", date: isoDate(today), paymentMethod: "transfer", accountOrCard: "월급통장", memo: "" }
  ],
  goals: [
    { id: "goal_001", name: "여행자금", targetAmount: 3000000, startDate: `${today.getFullYear()}-01-01`, endDate: `${today.getFullYear()}-12-31`, linkedCategoryIds: [], linkedFixedExpenseIds: ["fixed_001"], initialAmount: 400000, memo: "연말 여행을 위한 저축 목표" }
  ]
};

let state = loadState();
const uiState = loadUiState();
let spendingView = uiState.spendingView || "fixed";
let insightsView = uiState.insightsView || "goals";
let spendingCalendarOffset = Number(uiState.spendingCalendarOffset || 0);
let fixedFilter = uiState.fixedFilter || "all";
let expenseFilter = uiState.expenseFilter || "all";
let settingsView = uiState.settingsView || "categories";
let supabaseClient = null;
let supabaseUserId = "";
let supabaseReady = false;
let supabaseSaveTimer = null;
let supabaseIsSaving = false;

const app = document.querySelector("#app");
const title = document.querySelector("#screenTitle");
const dialog = document.querySelector("#editorDialog");
const form = document.querySelector("#editorForm");
const fields = document.querySelector("#editorFields");
const editorTitle = document.querySelector("#editorTitle");
const currentPage = getCurrentPage();

document.body.classList.add(`page-${currentPage}`);
document.querySelector("#todayLabel").textContent = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(today);

document.querySelectorAll(".tab-item").forEach((button) => {
  button.classList.toggle("active", button.dataset.section === currentPage);
});

document.querySelector("#resetDemoButton").addEventListener("click", () => {
  if (supabaseReady) {
    if (confirm("로그아웃할까요?")) signOut();
    return;
  }
  if (!confirm("샘플 데이터로 다시 시작할까요? 현재 입력한 데이터는 지워집니다.")) return;
  state = structuredClone(defaultState);
  saveState();
  render();
});

form.addEventListener("submit", (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  const handler = form.dataset.handler;
  const id = form.dataset.id || undefined;
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());
  data.linkedCategoryIds = formData.getAll("linkedCategoryIds").join(",");
  handlers[handler](data, id);
  dialog.close();
  saveState();
  render();
});

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return structuredClone(defaultState);
  try {
    return { ...structuredClone(defaultState), ...JSON.parse(saved) };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  queueSupabaseSave();
}

function loadUiState() {
  const saved = sessionStorage.getItem("money-management-ui-v1");
  if (!saved) return {};
  try {
    return JSON.parse(saved);
  } catch {
    return {};
  }
}

function saveUiState() {
  sessionStorage.setItem(
    "money-management-ui-v1",
    JSON.stringify({
      spendingView,
      insightsView,
      spendingCalendarOffset,
      fixedFilter,
      expenseFilter,
      settingsView
    })
  );
}

async function initSupabase() {
  const config = window.SUPABASE_CONFIG;
  if (!window.supabase || !config?.url || !config?.anonKey) {
    renderAuth("Supabase 설정을 불러오지 못했습니다.");
    return;
  }

  supabaseClient = window.supabase.createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
      storage: window.localStorage
    }
  });

  try {
    const authCode = new URLSearchParams(window.location.search).get("code");
    if (authCode) {
      const { error } = await supabaseClient.auth.exchangeCodeForSession(authCode);
      if (error) throw error;
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData.session?.user;

    if (!user?.id) {
      supabaseReady = false;
      renderAuth();
      return;
    }

    await startAuthenticatedSession(user);
  } catch (error) {
    supabaseReady = false;
    renderAuth("로그인 상태를 확인하지 못했습니다.");
    console.warn("Supabase 연결에 실패했습니다.", error);
  }
}

async function startAuthenticatedSession(user) {
  if (!user?.id) return;
  try {
    supabaseUserId = user.id;
    supabaseReady = true;
    document.body.classList.add("is-authenticated");
    await clearStoredCategoriesOnce();

    const remoteState = await loadSupabaseState();
    if (remoteState) {
      state = { ...state, ...remoteState };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } else {
      await persistSupabaseState();
    }
    render();
  } catch (error) {
    supabaseReady = false;
    renderAuth("데이터를 불러오지 못했습니다.");
    console.warn("Supabase 데이터 로딩에 실패했습니다.", error);
  }
}

function renderAuth(message = "") {
  document.body.classList.remove("is-authenticated");
  setTitle("로그인");
  app.innerHTML = `
    <section class="auth-screen">
      <div class="auth-copy">
        <p class="eyebrow">Money Management</p>
        <h2>계정으로 돈 관리를 시작하세요</h2>
        <p>고정지출과 설정 데이터를 Supabase에 안전하게 저장합니다.</p>
      </div>
      <form class="auth-form" data-auth-form="login">
        <label>
          이메일
          <input name="email" type="email" autocomplete="email" required>
        </label>
        <label>
          비밀번호
          <input name="password" type="password" autocomplete="current-password" minlength="6" required>
        </label>
        ${message ? `<p class="auth-message">${escapeHtml(message)}</p>` : ""}
        <div class="auth-actions">
          <button class="primary-button" type="submit" data-auth-mode="login">로그인</button>
          <button class="secondary-button" type="submit" data-auth-mode="signup">회원가입</button>
        </div>
      </form>
    </section>
  `;
  bindAuthActions();
}

function bindAuthActions() {
  app.querySelector("[data-auth-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitter = event.submitter;
    const mode = submitter?.dataset.authMode || "login";
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    await handleAuthSubmit(mode, email, password);
  });
}

async function handleAuthSubmit(mode, email, password) {
  if (!supabaseClient) {
    renderAuth("Supabase 클라이언트를 사용할 수 없습니다.");
    return;
  }

  const buttonText = mode === "signup" ? "회원가입" : "로그인";
  const emailRedirectTo = `${window.location.origin}${window.location.pathname}`;
  try {
    const { data, error } = mode === "signup"
      ? await supabaseClient.auth.signUp({ email, password, options: { emailRedirectTo } })
      : await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;

    if (data.session?.user) {
      await startAuthenticatedSession(data.session.user);
      return;
    }

    renderAuth("가입 확인 메일을 확인한 뒤 로그인해주세요.");
  } catch (error) {
    renderAuth(`${buttonText}에 실패했습니다. 이메일과 비밀번호를 확인해주세요.`);
    console.warn(`${buttonText} 실패`, error);
  }
}

async function signOut() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  supabaseReady = false;
  supabaseUserId = "";
  state = structuredClone(defaultState);
  renderAuth();
}

function queueSupabaseSave() {
  if (!supabaseReady || supabaseIsSaving) return;
  window.clearTimeout(supabaseSaveTimer);
  supabaseSaveTimer = window.setTimeout(() => {
    persistSupabaseState().catch((error) => {
      console.warn("Supabase 저장에 실패했습니다.", error);
    });
  }, 350);
}

async function loadSupabaseState() {
  const [accountsResult, categoriesResult, fixedExpensesResult, fixedLogsResult, statCardsResult, statLinksResult] = await Promise.all([
    supabaseClient.from("accounts").select("*").order("created_at", { ascending: true }),
    supabaseClient.from("categories").select("*").order("created_at", { ascending: true }),
    supabaseClient.from("fixed_expenses").select("*").order("payment_day", { ascending: true }),
    supabaseClient.from("fixed_expense_logs").select("*").order("scheduled_date", { ascending: true }),
    supabaseClient.from("fixed_stat_cards").select("*").order("sort_order", { ascending: true }),
    supabaseClient.from("fixed_stat_card_categories").select("*, fixed_stat_cards(stat_key)")
  ]);

  const results = [accountsResult, categoriesResult, fixedExpensesResult, fixedLogsResult, statCardsResult, statLinksResult];
  const error = results.find((result) => result.error)?.error;
  if (error) throw error;
  if (!accountsResult.data.length && !categoriesResult.data.length && !fixedExpensesResult.data.length) return null;

  const fixedStatCategories = { ...defaultState.fixedStatCategories };
  statCardsResult.data.forEach((card) => {
    fixedStatCategories[card.stat_key] = statLinksResult.data
      .filter((link) => link.stat_card_id === card.id)
      .map((link) => link.category_id);
  });

  return {
    accounts: accountsResult.data.map(accountFromRow),
    categories: categoriesResult.data.map(categoryFromRow),
    fixedExpenses: fixedExpensesResult.data.map(fixedExpenseFromRow),
    fixedLogs: fixedLogsResult.data.map(fixedLogFromRow),
    fixedStatCategories
  };
}

async function persistSupabaseState() {
  if (!supabaseReady || !supabaseUserId) return;
  supabaseIsSaving = true;
  normalizeStateIdsForSupabase();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  try {
    const accounts = state.accounts.map(accountToRow);
    const categories = state.categories.map(categoryToRow);
    const fixedExpenses = state.fixedExpenses.map(fixedExpenseToRow);
    const fixedLogs = state.fixedLogs.map(fixedLogToRow);
    const statCards = fixedStatDefinitions().map((item, index) => ({
      user_id: supabaseUserId,
      stat_key: item.key,
      title: item.label,
      sort_order: index
    }));

    await upsertSupabaseRows("accounts", accounts, "id");
    await upsertSupabaseRows("categories", categories, "id");
    await upsertSupabaseRows("fixed_expenses", fixedExpenses, "id");
    await upsertSupabaseRows("fixed_expense_logs", fixedLogs, "id");
    await upsertSupabaseRows("fixed_stat_cards", statCards, "user_id,stat_key");

    const { data: savedStatCards, error: statCardError } = await supabaseClient.from("fixed_stat_cards").select("id, stat_key");
    if (statCardError) throw statCardError;

    const { error: deleteLinksError } = await supabaseClient.from("fixed_stat_card_categories").delete().eq("user_id", supabaseUserId);
    if (deleteLinksError) throw deleteLinksError;

    const statLinks = savedStatCards.flatMap((card) => getStatCategoryIds(card.stat_key).map((categoryId) => ({
      user_id: supabaseUserId,
      stat_card_id: card.id,
      category_id: categoryId
    })));
    if (statLinks.length) await upsertSupabaseRows("fixed_stat_card_categories", statLinks, "user_id,stat_card_id,category_id");
  } finally {
    supabaseIsSaving = false;
  }
}

async function upsertSupabaseRows(table, rows, onConflict) {
  if (!rows.length) return;
  const { error } = await supabaseClient.from(table).upsert(rows, { onConflict });
  if (error) throw error;
}

async function clearStoredCategoriesOnce() {
  const clearKey = `${CATEGORY_CLEAR_KEY}-${supabaseUserId}`;
  if (localStorage.getItem(clearKey)) return;
  const { error } = await supabaseClient.from("categories").delete().eq("user_id", supabaseUserId);
  if (error) throw error;
  localStorage.setItem(clearKey, "true");
}

async function deleteSupabaseRow(table, id) {
  if (!supabaseReady || !supabaseClient || !isUuid(id)) return;
  const { error } = await supabaseClient.from(table).delete().eq("id", id).eq("user_id", supabaseUserId);
  if (error) console.warn(`${table} 삭제에 실패했습니다.`, error);
}

function normalizeStateIdsForSupabase() {
  const accountIdMap = normalizeIds(state.accounts);
  const categoryIdMap = normalizeIds(state.categories);
  const fixedIdMap = normalizeIds(state.fixedExpenses);
  normalizeIds(state.fixedLogs);

  state.fixedExpenses.forEach((item) => {
    item.categoryId = categoryIdMap.get(item.categoryId) || item.categoryId;
    item.withdrawalAccountId = accountIdMap.get(item.withdrawalAccountId) || item.withdrawalAccountId;
  });
  state.fixedLogs.forEach((log) => {
    log.fixedExpenseId = fixedIdMap.get(log.fixedExpenseId) || log.fixedExpenseId;
  });
  state.expenses.forEach((expense) => {
    expense.categoryId = categoryIdMap.get(expense.categoryId) || expense.categoryId;
  });
  state.goals.forEach((goal) => {
    goal.linkedCategoryIds = (goal.linkedCategoryIds || []).map((id) => categoryIdMap.get(id) || id);
    goal.linkedFixedExpenseIds = (goal.linkedFixedExpenseIds || []).map((id) => fixedIdMap.get(id) || id);
  });
  Object.keys(state.fixedStatCategories || {}).forEach((key) => {
    state.fixedStatCategories[key] = state.fixedStatCategories[key].map((id) => categoryIdMap.get(id) || id);
  });
}

function normalizeIds(items) {
  const idMap = new Map();
  items.forEach((item) => {
    if (isUuid(item.id)) return;
    const nextId = crypto.randomUUID();
    idMap.set(item.id, nextId);
    item.id = nextId;
  });
  return idMap;
}

function accountToRow(account) {
  return {
    id: account.id,
    user_id: supabaseUserId,
    name: account.name,
    institution: account.institution || null,
    account_type: account.accountType || "bank",
    last_four_digits: account.lastFourDigits || null,
    is_default: Boolean(account.isDefault),
    color: account.color || "#007aff",
    memo: account.memo || null,
    is_active: account.isActive !== false
  };
}

function categoryToRow(category) {
  return {
    id: category.id,
    user_id: supabaseUserId,
    name: category.name,
    type: category.type,
    available_tabs: category.availableTabs || ["fixed", "variable"],
    color: category.color || "#007aff",
    icon: category.icon || null,
    is_active: category.isActive !== false
  };
}

function fixedExpenseToRow(item) {
  return {
    id: item.id,
    user_id: supabaseUserId,
    name: item.name,
    amount: Number(item.amount || 0),
    category_id: item.categoryId || null,
    type: item.type,
    withdrawal_account_id: item.withdrawalAccountId || null,
    to_account: item.toAccount || null,
    transfer_type: item.transferType || "unset",
    payment_day: Number(item.paymentDay || 1),
    cycle: item.cycle || "monthly",
    start_date: item.startDate || null,
    maturity_date: item.maturityDate || null,
    auto_complete: Boolean(item.autoComplete),
    is_ended: Boolean(item.isEnded),
    memo: item.memo || null
  };
}

function fixedLogToRow(log) {
  return {
    id: log.id,
    user_id: supabaseUserId,
    fixed_expense_id: log.fixedExpenseId,
    period_key: log.periodKey,
    status: log.status,
    scheduled_date: log.scheduledDate,
    completed_date: log.completedDate || null,
    actual_amount: log.actualAmount == null ? null : Number(log.actualAmount),
    memo: log.memo || null
  };
}

function accountFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    institution: row.institution || "",
    accountType: row.account_type,
    lastFourDigits: row.last_four_digits || "",
    isDefault: row.is_default,
    color: row.color,
    memo: row.memo || "",
    isActive: row.is_active
  };
}

function categoryFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    availableTabs: row.available_tabs || ["fixed", "variable"],
    color: row.color,
    icon: row.icon || "",
    isActive: row.is_active
  };
}

function fixedExpenseFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    amount: row.amount,
    categoryId: row.category_id,
    type: row.type,
    withdrawalAccountId: row.withdrawal_account_id,
    toAccount: row.to_account || "",
    transferType: row.transfer_type,
    paymentDay: row.payment_day,
    cycle: row.cycle,
    startDate: row.start_date || "",
    maturityDate: row.maturity_date || "",
    autoComplete: row.auto_complete,
    isEnded: row.is_ended,
    memo: row.memo || ""
  };
}

function fixedLogFromRow(row) {
  return {
    id: row.id,
    fixedExpenseId: row.fixed_expense_id,
    periodKey: row.period_key,
    status: row.status,
    scheduledDate: row.scheduled_date,
    completedDate: row.completed_date || "",
    actualAmount: row.actual_amount,
    memo: row.memo || ""
  };
}

function render() {
  if (currentPage === "spending") {
    if (spendingView === "fixed") renderFixed();
    else renderExpenses();
    return;
  }

  if (currentPage === "insights") {
    if (insightsView === "goals") renderGoals();
    else renderAnalytics();
    return;
  }

  renderSettings();
}

function setTitle(value) {
  title.textContent = value;
}

function renderFixed() {
  setTitle("고정지출");
  const targetPeriodKey = spendingPeriodKey();
  const monthDate = addMonths(today, spendingCalendarOffset);
  const summary = getSummary(targetPeriodKey);
  const items = getFixedItemsForPeriod(targetPeriodKey);
  const filtered = fixedFilter === "all" ? items : items.filter((item) => item.status === fixedFilter);
  const dateLine = `${String(monthDate.getFullYear()).slice(2)}년 ${monthDate.getMonth() + 1}월`;
  const highlightCards = fixedStatCards(items);
  const visibleItems = filtered.length ? filtered : items;

  app.innerHTML = `
    <section class="spending-screen">
      <div class="spending-header">
        <div>
          <div class="month-label">${dateLine}</div>
        <div class="mode-tabs">
          <button class="mode-tab active" data-segment-group="spendingView" data-value="fixed" type="button">고정 지출</button>
          <button class="mode-tab" data-segment-group="spendingView" data-value="expenses" type="button">소비 지출</button>
        </div>
      </div>
        <div class="spending-header-actions">
          <button class="mini-text-button" data-action="logout" type="button">로그아웃</button>
          <button class="gear-button" data-action="open-fixed-settings" type="button" aria-label="고정지출 설정">${lineIcon("settings")}</button>
        </div>
      </div>
      ${fixedMonthCalendar(monthDate)}
      <section class="overview-block">
        <p class="section-eyebrow">이번 달 총합</p>
        <h2 class="overview-amount">${money(summary.planned)}</h2>
        <div class="overview-grid">
          ${highlightCards
            .map(
              (card) => `
                <button class="overview-card ${card.tone}" data-action="open-stat-detail" data-stat-key="${card.key}" type="button">
                  <span>${card.label}</span>
                  <strong>${card.amount}</strong>
                </button>
              `
            )
            .join("")}
        </div>
      </section>
      <section class="list-block">
        <p class="section-eyebrow">이번 달 고정지출</p>
        <div class="fixed-list">
          ${visibleItems.length ? groupedFixedItems(visibleItems) : empty("이번 달 고정지출 내역이 없습니다.")}
        </div>
      </section>
    </section>
  `;
  bindCommonActions();
}

function groupedFixedItems(items) {
  const groups = new Map();
  items.forEach((item) => {
    const day = Number(item.paymentDay || 1);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(item);
  });

  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, dayItems]) => `
      <section class="fixed-day-group">
        <p class="fixed-day-label">${day}일</p>
        <div class="fixed-day-list">${dayItems.map(fixedScreenshotItem).join("")}</div>
      </section>
    `)
    .join("");
}

function fixedScreenshotItem(item) {
  const account = findById(state.accounts, item.withdrawalAccountId);
  const category = findById(state.categories, item.categoryId);
  const maturity = item.maturityDate ? `<span class="maturity-pill">${escapeHtml(formatShortDate(item.maturityDate))} 만기</span>` : "";
  const done = getFixedStatus(item, spendingPeriodKey()) === "completed";
  return `
    <article class="fixed-screenshot-card">
      <button class="check-button ${done ? "done" : ""}" data-action="toggle-fixed" data-id="${item.id}" type="button" aria-label="${done ? "지출 완료 해제" : "지출 완료 체크"}" aria-pressed="${done}">${done ? lineIcon("check") : ""}</button>
      <div class="fixed-screenshot-main">
        <div class="fixed-screenshot-top">
          <span class="fixed-screenshot-title"><span class="fixed-screenshot-name">${escapeHtml(item.name || "월세")}</span>${maturity}</span>
          <span class="fixed-screenshot-badge">${lineIcon("wallet")} ${escapeHtml(category?.name || "미분류")} · 매달 ${item.paymentDay || 1}일</span>
        </div>
        <strong class="fixed-screenshot-amount">${money(item.amount || 500000)}</strong>
        <p class="fixed-screenshot-sub">${escapeHtml(account?.name || "출금통장 미지정")} -> ${escapeHtml(item.toAccount || "입금통장 미지정")} · ${transferLabel(item.transferType)}</p>
      </div>
    </article>
  `;
}

function fixedMonthCalendar(monthDate) {
  const targetPeriodKey = toPeriodKey(monthDate);
  const days = buildCalendarDays(monthDate);
  const counts = fixedCalendarCounts(targetPeriodKey);
  return `
    <section class="month-calendar" data-calendar-swipe="true" aria-label="월별 고정지출 달력">
      <div class="month-calendar-head">
        <button class="calendar-nav-button" data-calendar-nav="-1" type="button" aria-label="이전 달">${lineIcon("chevronLeft")}</button>
        <span>${monthDate.getFullYear()}년 ${monthDate.getMonth() + 1}월</span>
        <button class="calendar-nav-button" data-calendar-nav="1" type="button" aria-label="다음 달">${lineIcon("chevronRight")}</button>
      </div>
      <div class="month-weekdays" aria-hidden="true">
        ${["일", "월", "화", "수", "목", "금", "토"].map((day) => `<span>${day}</span>`).join("")}
      </div>
      <div class="month-calendar-grid">
        ${days.map((day) => {
          const dateKey = toDateKey(day.date);
          const inMonth = day.date.getMonth() === monthDate.getMonth();
          const isToday = dateKey === toDateKey(today);
          const count = counts[dateKey] || 0;
          return `
            <button class="month-day-card ${inMonth ? "" : "dim"} ${isToday ? "today" : ""} ${count ? "has-fixed" : ""}" data-action="open-day-fixed" data-date="${dateKey}" type="button" aria-label="${dateKey} 고정지출">
              <span>${day.date.getDate()}</span>
              ${count ? `<em>${count}</em>` : ""}
            </button>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function fixedStatCards(items) {
  return fixedStatDefinitions().map((group) => {
    const linkedCategories = getStatCategoryIds(group.key);
    const matched = items.filter((item) => linkedCategories.includes(item.categoryId));
    return { ...group, amount: money(matched.reduce((sum, item) => sum + Number(item.amount), 0)), items: matched };
  });
}

function fixedStatDefinitions() {
  return [
    { key: "saving", label: "저축·적금", tone: "blue" },
    { key: "expense", label: "지출", tone: "red" },
    { key: "subscription", label: "구독료", tone: "neutral" },
    { key: "emergency", label: "개인 비상금", tone: "neutral" }
  ];
}

function lineIcon(name) {
  const paths = {
    settings: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 0 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 0 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 .9-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 0 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5.9h.1a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"></path>',
    check: '<path d="m5 12 4 4 10-10"></path>',
    wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 16.5v-9Z"></path><path d="M4 8h14a2 2 0 0 1 2 2v1.5h-4a2.5 2.5 0 0 0 0 5h4"></path><path d="M16 14h.01"></path>',
    chevronLeft: '<path d="m15 18-6-6 6-6"></path>',
    chevronRight: '<path d="m9 18 6-6-6-6"></path>'
  };
  return `<svg class="line-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ""}</svg>`;
}

function fixedItem(item) {
  const category = findById(state.categories, item.categoryId);
  const account = findById(state.accounts, item.withdrawalAccountId);
  const done = item.status === "completed";
  const statusClass = item.status === "completed" ? "green" : item.status === "pending" ? "red" : "orange";
  return `
    <article class="money-item">
      <button class="check-button ${done ? "done" : ""}" data-action="toggle-fixed" data-id="${item.id}" type="button" aria-label="완료 체크">${done ? lineIcon("check") : ""}</button>
      <div class="item-body">
        <div class="item-title-row">
          <span class="color-dot" style="--dot:${category?.color || "#8e8e93"}"></span>
          <strong>${escapeHtml(item.name)}</strong>
          <span class="pill ${item.type === "saving" ? "green" : "blue"}">${typeLabel(item.type)}</span>
        </div>
        <p class="item-meta">${money(item.amount)} · ${category?.name || "미분류"} · 매월 ${item.paymentDay}일</p>
        <p class="item-meta">${account?.name || "계좌 미지정"} → ${escapeHtml(item.toAccount || "이동처 미지정")}</p>
        <p class="item-meta">${transferLabel(item.transferType)} · <span class="pill ${statusClass}">${statusLabel(item.status, item.log)}</span></p>
      </div>
      <div class="item-actions">
        <span class="amount">${money(item.amount)}</span>
        <button class="secondary-button" data-action="edit-fixed" data-id="${item.id}" type="button">수정</button>
      </div>
    </article>
  `;
}

function renderExpenses() {
  setTitle("소비지출");
  const summary = getSummary(spendingPeriodKey());
  const items = state.expenses
    .filter((item) => expenseFilter === "all" || item.type === expenseFilter)
    .filter((item) => item.date.startsWith(spendingPeriodKey()))
    .sort((a, b) => b.date.localeCompare(a.date));

  app.innerHTML = `
    <section class="spending-hero">
      <div class="spending-hero-copy">
        <p class="eyebrow">소비지출</p>
        <h2>${money(summary.variableExpense + summary.extraSaving)}</h2>
        <p class="spending-hero-sub">날짜별 소비와 추가 저축을 함께 기록합니다.</p>
      </div>
      <div class="spending-hero-badge">
        <span>선택 월</span>
        <strong>${spendingPeriodKey()}</strong>
      </div>
    </section>
    ${calendarCard()}
    ${sectionSwitcher("spendingView", spendingView, [["fixed", "고정지출"], ["expenses", "소비지출"]])}
    <section class="stats-grid">
      ${statTile("소비지출", money(summary.variableExpense))}
      ${statTile("추가 저축", money(summary.extraSaving))}
      ${statTile("기록 수", `${items.length}개`)}
      ${statTile("평균", money(items.length ? Math.round((summary.variableExpense + summary.extraSaving) / items.length) : 0))}
    </section>
    <div class="toolbar wrap">
      ${segments("expenseFilter", expenseFilter, [["all", "전체"], ["expense", "지출"], ["saving", "저축"]])}
      <button class="primary-button" data-action="new-expense" type="button">추가</button>
    </div>
    <section class="list-card">
      <div class="section-title"><h3>날짜별 기록</h3><span class="muted">${items.length}개</span></div>
      <div class="money-list">${items.length ? items.map(expenseItem).join("") : empty("아직 기록이 없습니다.")}</div>
    </section>
  `;
  bindCommonActions();
}

function expenseItem(item) {
  const category = findById(state.categories, item.categoryId);
  return `
    <article class="money-item">
      <span class="pill ${item.type === "saving" ? "green" : "blue"}">${typeLabel(item.type)}</span>
      <div class="item-body">
        <div class="item-title-row">
          <span class="color-dot" style="--dot:${category?.color || "#8e8e93"}"></span>
          <strong>${escapeHtml(item.name)}</strong>
        </div>
        <p class="item-meta">${item.date} · ${category?.name || "미분류"} · ${paymentLabel(item.paymentMethod)}</p>
        <p class="item-meta">${escapeHtml(item.accountOrCard || "수단 미입력")}${item.memo ? ` · ${escapeHtml(item.memo)}` : ""}</p>
      </div>
      <div class="item-actions">
        <span class="amount">${money(item.amount)}</span>
        <button class="secondary-button" data-action="edit-expense" data-id="${item.id}" type="button">수정</button>
      </div>
    </article>
  `;
}

function renderAnalytics() {
  setTitle("지출 분석");
  const summary = getSummary();
  const expenseCategories = categoryTotals("expense");
  const savingCategories = categoryTotals("saving");
  const accountTotals = state.accounts.map((account) => ({
    label: account.name,
    color: account.color,
    value: state.fixedExpenses.filter((item) => item.withdrawalAccountId === account.id).reduce((sum, item) => sum + Number(item.amount), 0)
  })).filter((item) => item.value > 0);

  app.innerHTML = `
    ${sectionSwitcher("insightsView", insightsView, [["goals", "목표"], ["analytics", "지출 분석"]])}
    ${summaryCard("완료 기준 총 지출", summary.totalExpense, periodKey, [
      ["총 저축", summary.totalSaving],
      ["예정 고정", summary.planned],
      ["완료 고정", summary.completed],
      ["미완료 고정", summary.pending]
    ])}
    <section class="list-card">
      <div class="section-title"><h3>카테고리별 소비</h3><span class="muted">${money(sumValues(expenseCategories))}</span></div>
      ${chartRows(expenseCategories)}
    </section>
    <section class="list-card">
      <div class="section-title"><h3>카테고리별 저축</h3><span class="muted">${money(sumValues(savingCategories))}</span></div>
      ${chartRows(savingCategories)}
    </section>
    <section class="list-card">
      <div class="section-title"><h3>계좌별 출금 예정</h3><span class="muted">${money(sumValues(accountTotals))}</span></div>
      ${chartRows(accountTotals)}
    </section>
  `;
  bindCommonActions();
}

function renderGoals() {
  setTitle("저축 목표");
  const activeGoals = state.goals.filter((goal) => getGoalState(goal) === "active");
  const completedGoals = state.goals.filter((goal) => getGoalState(goal) !== "active");
  app.innerHTML = `
    <section class="goals-screen">
      <div class="goals-header">
        <div class="goals-tabs">
          <button class="goals-tab active" data-segment-group="insightsView" data-value="goals" type="button">저축 목표</button>
          <button class="goals-tab" data-segment-group="insightsView" data-value="analytics" type="button">지출 분석</button>
        </div>
        <button class="goal-add-button" data-action="new-goal" type="button">+ 목표 추가</button>
      </div>
      <div class="goal-card-list">
        ${activeGoals.length ? activeGoals.map(goalCard).join("") : empty("저축 목표를 추가해보세요.")}
      </div>
      <section class="completed-goals">
        <p class="completed-goals-title">완료된 목표</p>
        <div class="goal-card-list compact">
          ${completedGoals.length ? completedGoals.map(goalCard).join("") : empty("완료된 목표가 없습니다.")}
        </div>
      </section>
    </section>
  `;
  bindCommonActions();
}

function goalCard(goal) {
  const saved = goalSavedAmount(goal);
  const rate = Math.min(100, Math.round((saved / Number(goal.targetAmount || 1)) * 100));
  const goalState = getGoalState(goal);
  const stateLabel = goalState === "completed" ? "성공" : goalState === "failed" ? "실패" : `D-${daysUntil(goal.endDate)}`;
  const linkedLabel = goalCategoryNames(goal).join(" · ") || "연결 없음";
  return `
    <article class="goal-card ${goalState}" data-action="open-goal-detail" data-id="${goal.id}" role="button" tabindex="0">
      <div class="goal-card-top">
        <strong class="goal-dday">${stateLabel}</strong>
        <div class="goal-title-line">
          <strong>${escapeHtml(goal.name)}</strong>
          <span>${formatGoalDate(goal.startDate)} - ${formatGoalDate(goal.endDate)}</span>
        </div>
        <span class="goal-link-label">${escapeHtml(linkedLabel)}</span>
      </div>
      <p class="goal-amount-line"><strong>${money(saved)}</strong><span>/ ${money(goal.targetAmount)}</span></p>
      <div class="goal-progress-row">
        <span>${rate}%</span>
        <div class="goal-progress"><div style="width:${rate}%"></div></div>
      </div>
    </article>
  `;
}

function renderSettings() {
  setTitle("관리");
  const rows = settingsView === "accounts" ? state.accounts.map(accountItem).join("") : state.categories.map(categoryItem).join("");
  app.innerHTML = `
    <div class="toolbar wrap">
      ${segments("settingsView", settingsView, [["categories", "카테고리"], ["accounts", "출금계좌"]])}
      <button class="primary-button" data-action="${settingsView === "accounts" ? "new-account" : "new-category"}" type="button">추가</button>
    </div>
    <section class="list-card">
      <div class="section-title"><h3>${settingsView === "accounts" ? "출금계좌" : "카테고리"}</h3><span class="muted">${settingsView === "accounts" ? state.accounts.length : state.categories.length}개</span></div>
      <div class="money-list">${rows || empty("등록된 항목이 없습니다.")}</div>
    </section>
  `;
  bindCommonActions();
}

function accountItem(account) {
  const total = state.fixedExpenses.filter((item) => item.withdrawalAccountId === account.id).reduce((sum, item) => sum + Number(item.amount), 0);
  return `
    <article class="money-item">
      <span class="color-dot" style="--dot:${account.color}"></span>
      <div class="item-body">
        <div class="item-title-row"><strong>${escapeHtml(account.name)}</strong>${account.isDefault ? '<span class="pill blue">기본</span>' : ""}${!account.isActive ? '<span class="pill red">비활성</span>' : ""}</div>
        <p class="item-meta">${escapeHtml(account.institution || "기관 미입력")} · ${accountTypeLabel(account.accountType)} · ${account.lastFourDigits || "뒷자리 없음"}</p>
        <p class="item-meta">이번 달 출금 예정 ${money(total)}</p>
      </div>
      <div class="item-actions"><button class="secondary-button" data-action="edit-account" data-id="${account.id}" type="button">수정</button></div>
    </article>
  `;
}

function categoryItem(category) {
  return `
    <article class="money-item">
      <span class="color-dot" style="--dot:${category.color}"></span>
      <div class="item-body">
        <div class="item-title-row"><strong>${category.icon || "•"} ${escapeHtml(category.name)}</strong><span class="pill ${category.type === "saving" ? "green" : "blue"}">${typeLabel(category.type)}</span>${!category.isActive ? '<span class="pill red">비활성</span>' : ""}</div>
        <p class="item-meta">${availableLabel(category.availableTabs)}</p>
      </div>
      <div class="item-actions"><button class="secondary-button" data-action="edit-category" data-id="${category.id}" type="button">수정</button></div>
    </article>
  `;
}

function bindCommonActions() {
  app.querySelectorAll("[data-calendar-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      spendingCalendarOffset += Number(button.dataset.calendarNav);
      saveUiState();
      render();
    });
  });

  app.querySelectorAll("[data-calendar-swipe]").forEach((calendar) => {
    let startX = 0;
    calendar.addEventListener("touchstart", (event) => {
      startX = event.touches[0]?.clientX || 0;
    }, { passive: true });
    calendar.addEventListener("touchend", (event) => {
      const endX = event.changedTouches[0]?.clientX || 0;
      const delta = endX - startX;
      if (Math.abs(delta) < 44) return;
      spendingCalendarOffset += delta < 0 ? 1 : -1;
      saveUiState();
      render();
    }, { passive: true });
  });

  app.querySelectorAll("[data-segment-group]").forEach((button) => {
    button.addEventListener("click", () => {
      const group = button.dataset.segmentGroup;
      if (group === "spendingView") spendingView = button.dataset.value;
      if (group === "insightsView") insightsView = button.dataset.value;
      if (group === "fixedFilter") fixedFilter = button.dataset.value;
      if (group === "expenseFilter") expenseFilter = button.dataset.value;
      if (group === "settingsView") settingsView = button.dataset.value;
      saveUiState();
      render();
    });
  });

  app.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button.dataset.action, button.dataset.id, button.dataset));
  });
}

function handleAction(action, id, dataset = {}) {
  const actionMap = {
    "new-fixed": () => openFixedEditor(),
    "edit-fixed": () => openFixedEditor(findById(state.fixedExpenses, id)),
    "delete-fixed": () => deleteFixedExpense(id),
    "toggle-fixed": () => toggleFixed(id),
    "open-day-fixed": () => openDayFixedDialog(dataset.date),
    "open-fixed-settings": () => openFixedSettingsDialog(),
    "open-stat-detail": () => openFixedStatDialog(dataset.statKey),
    logout: () => signOut(),
    "new-expense": () => openExpenseEditor(),
    "edit-expense": () => openExpenseEditor(findById(state.expenses, id)),
    "new-account": () => openAccountEditor(),
    "edit-account": () => openAccountEditor(findById(state.accounts, id)),
    "new-category": () => openCategoryEditor(),
    "edit-category": () => openCategoryEditor(findById(state.categories, id)),
    "delete-category": () => deleteCategory(id),
    "new-goal": () => openGoalEditor(),
    "edit-goal": () => openGoalEditor(findById(state.goals, id)),
    "delete-goal": () => deleteGoal(id),
    "open-goal-detail": () => openGoalDetailDialog(findById(state.goals, id))
  };
  actionMap[action]?.();
}

function openDayFixedDialog(dateKey) {
  const items = getFixedItemsForDate(dateKey);
  const title = `${Number(dateKey.slice(-2))}일 고정지출`;
  openViewDialog(
    title,
    items.length
      ? `<div class="dialog-list">${items.map(fixedScreenshotItem).join("")}</div>`
      : empty("해당 날짜에 고정지출 내역이 없습니다.")
  );
}

function openFixedStatDialog(statKey) {
  const items = getFixedStatItems(statKey, spendingPeriodKey());
  const labels = statLabelMap();
  const total = items.reduce((sum, item) => sum + Number(item.amount), 0);
  const linkedNames = getStatCategoryIds(statKey).map((id) => findById(state.categories, id)?.name).filter(Boolean);
  openViewDialog(
    `${labels[statKey] || "내역"} 상세`,
    `
      <div class="dialog-summary">
        <span>${linkedNames.length ? linkedNames.join(", ") : "연결된 카테고리 없음"}</span>
        <strong>${money(total)}</strong>
      </div>
      <div class="dialog-toolbar">
        <button class="secondary-button" data-view-action="configure-stat" data-stat-key="${statKey}" type="button">카테고리 설정</button>
      </div>
      <div class="dialog-list">${items.length ? items.map(fixedScreenshotItem).join("") : empty("표시할 내역이 없습니다.")}</div>
    `
  );
}

function openStatCategoryDialog(statKey) {
  const labels = statLabelMap();
  const linked = new Set(getStatCategoryIds(statKey));
  const options = state.categories.filter((category) => category.availableTabs.includes("fixed"));
  openViewDialog(
    `${labels[statKey] || "통계"} 카테고리 설정`,
    `
      <div class="category-check-list">
        ${options.map((category) => `
          <label class="category-check-row">
            <input data-stat-category="${category.id}" type="checkbox" ${linked.has(category.id) ? "checked" : ""}>
            <span class="color-dot" style="--dot:${category.color || "#8e8e93"}"></span>
            <span>${escapeHtml(category.name)}</span>
          </label>
        `).join("")}
      </div>
      <div class="dialog-toolbar">
        <button class="primary-button" data-save-stat-categories="${statKey}" type="button">저장</button>
      </div>
    `
  );
}

function openGoalDetailDialog(goal) {
  if (!goal) return;
  const items = goalContributionItems(goal);
  const saved = goalSavedAmount(goal);
  openViewDialog(
    `${goal.name} 모은 내역`,
    `
      <div class="dialog-summary">
        <span>${formatGoalDate(goal.startDate)} - ${formatGoalDate(goal.endDate)}</span>
        <strong>${money(saved)}</strong>
      </div>
      <div class="goal-detail-list">
        ${items.length ? items.map(goalContributionItem).join("") : empty("아직 모은 내역이 없습니다.")}
      </div>
      <div class="dialog-toolbar">
        <button class="secondary-button" data-view-action="edit-goal" data-id="${goal.id}" type="button">수정</button>
        <button class="danger-button" data-view-action="delete-goal" data-id="${goal.id}" type="button">삭제</button>
      </div>
    `
  );
}

function goalContributionItem(item) {
  return `
    <article class="goal-detail-item">
      <div>
        <span>${formatGoalDate(item.date)}</span>
        <strong>${escapeHtml(item.name)}</strong>
        <p>${escapeHtml(item.source)}</p>
      </div>
      <strong>${money(item.amount)}</strong>
    </article>
  `;
}

function openFixedSettingsDialog(tab = "ongoing") {
  const ongoingItems = getFixedItemsForPeriod(spendingPeriodKey(), { includeEnded: false });
  const endedItems = getEndedFixedItems();
  const items = tab === "ended" ? endedItems : ongoingItems;
  openViewDialog(
    "고정지출 설정",
    `
      <div class="dialog-tabs">
        <button class="dialog-tab ${tab === "ongoing" ? "active" : ""}" data-settings-tab="ongoing" type="button">진행중인 고정지출</button>
        <button class="dialog-tab ${tab === "ended" ? "active" : ""}" data-settings-tab="ended" type="button">종료된 고정지출</button>
      </div>
      <div class="dialog-toolbar">
        <button class="primary-button" data-view-action="new-fixed" type="button">고정지출 추가</button>
      </div>
      <div class="dialog-list">${items.length ? items.map(fixedSettingsCard).join("") : empty(tab === "ended" ? "종료된 고정지출이 없습니다." : "진행중인 고정지출이 없습니다.")}</div>
    `,
    (viewDialog) => {
      viewDialog.querySelectorAll("[data-settings-tab]").forEach((button) => {
        button.addEventListener("click", () => openFixedSettingsDialog(button.dataset.settingsTab));
      });
    }
  );
}

function fixedSettingsCard(item) {
  const ended = isFixedEnded(item);
  const matured = isMaturedFixed(item);
  return `
    <article class="fixed-settings-card">
      ${fixedScreenshotItem(item)}
      <div class="settings-card-actions">
        <label class="toggle-row">
          <input data-toggle-ended="${item.id}" type="checkbox" ${ended ? "checked" : ""} ${matured ? "disabled" : ""}>
          <span>${matured ? "만기 종료" : "종료된 고정지출"}</span>
        </label>
        <div class="settings-card-buttons">
          <button class="secondary-button" data-view-action="edit-fixed" data-id="${item.id}" type="button">수정</button>
          <button class="danger-button" data-view-action="delete-fixed" data-id="${item.id}" type="button">삭제</button>
        </div>
      </div>
    </article>
  `;
}

function openViewDialog(titleText, bodyHtml, afterRender) {
  let viewDialog = document.querySelector("#viewDialog");
  if (!viewDialog) {
    viewDialog = document.createElement("dialog");
    viewDialog.id = "viewDialog";
    viewDialog.className = "sheet view-sheet";
    document.body.append(viewDialog);
  }

  viewDialog.innerHTML = `
    <div class="sheet-panel">
      <div class="sheet-header">
        <h2>${escapeHtml(titleText)}</h2>
        <button class="icon-button" data-view-close type="button" aria-label="닫기">
          <svg class="line-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
        </button>
      </div>
      <div class="view-body">${bodyHtml}</div>
    </div>
  `;
  bindViewDialogActions(viewDialog);
  afterRender?.(viewDialog);
  if (!viewDialog.open) viewDialog.showModal();
}

function bindViewDialogActions(viewDialog) {
  viewDialog.querySelector("[data-view-close]")?.addEventListener("click", () => viewDialog.close());
  viewDialog.querySelectorAll("[data-view-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.viewAction;
      if (action === "new-fixed") openFixedEditor();
      if (action === "edit-fixed") openFixedEditor(findById(state.fixedExpenses, button.dataset.id));
      if (action === "delete-fixed") deleteFixedExpense(button.dataset.id);
      if (action === "configure-stat") openStatCategoryDialog(button.dataset.statKey);
      if (action === "edit-goal") openGoalEditor(findById(state.goals, button.dataset.id));
      if (action === "delete-goal") deleteGoal(button.dataset.id);
    });
  });
  viewDialog.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button.dataset.action, button.dataset.id, button.dataset));
  });
  viewDialog.querySelectorAll("[data-toggle-ended]").forEach((input) => {
    input.addEventListener("change", () => {
      const item = findById(state.fixedExpenses, input.dataset.toggleEnded);
      if (!item || isMaturedFixed(item)) return;
      item.isEnded = input.checked;
      saveState();
      openFixedSettingsDialog(input.checked ? "ended" : "ongoing");
      render();
    });
  });
  viewDialog.querySelector("[data-save-stat-categories]")?.addEventListener("click", (event) => {
    const statKey = event.currentTarget.dataset.saveStatCategories;
    const selected = [...viewDialog.querySelectorAll("[data-stat-category]:checked")].map((input) => input.dataset.statCategory);
    state.fixedStatCategories = { ...(state.fixedStatCategories || {}), [statKey]: selected };
    saveState();
    render();
    openFixedStatDialog(statKey);
  });
}

function closeViewDialog() {
  const viewDialog = document.querySelector("#viewDialog");
  if (viewDialog?.open) viewDialog.close();
}

function openFixedEditor(item = {}) {
  closeViewDialog();
  openEditor("고정지출", "fixed", item.id, [
    field("name", "지출명", "text", item.name, true),
    field("amount", "금액", "number", item.amount, true),
    selectField("type", "분류", item.type || "expense", [["expense", "지출"], ["saving", "저축"]]),
    selectField("categoryId", "카테고리", item.categoryId, categoryOptions("fixed")),
    selectField("withdrawalAccountId", "출금계좌", item.withdrawalAccountId || defaultAccountId(), accountOptions()),
    field("toAccount", "이동처", "text", item.toAccount),
    selectField("transferType", "납부 방식", item.transferType || "unset", [["auto", "자동이체"], ["manual", "직접 납부"], ["unset", "미설정"]]),
    field("paymentDay", "출금일", "number", item.paymentDay || 1, true, "1", "31"),
    selectField("cycle", "반복 주기", item.cycle || "monthly", [["monthly", "매월"], ["weekly", "매주"], ["yearly", "매년"]]),
    field("startDate", "시작일", "date", item.startDate),
    field("maturityDate", "만기일", "date", item.maturityDate),
    selectField("autoComplete", "자동 완료", String(item.autoComplete || false), [["false", "사용 안 함"], ["true", "사용"]]),
    selectField("isEnded", "종료 여부", String(item.isEnded || false), [["false", "진행중"], ["true", "종료"]]),
    textArea("memo", "메모", item.memo)
  ]);
}

function openExpenseEditor(item = {}) {
  openEditor("소비지출", "expense", item.id, [
    field("name", "지출명", "text", item.name, true),
    field("amount", "금액", "number", item.amount, true),
    field("date", "날짜", "date", item.date || isoDate(today), true),
    selectField("type", "분류", item.type || "expense", [["expense", "지출"], ["saving", "저축"]]),
    selectField("categoryId", "카테고리", item.categoryId, categoryOptions("variable")),
    selectField("paymentMethod", "결제수단", item.paymentMethod || "card", [["card", "카드"], ["cash", "현금"], ["transfer", "계좌이체"], ["etc", "기타"]]),
    field("accountOrCard", "사용 계좌/카드", "text", item.accountOrCard),
    textArea("memo", "메모", item.memo)
  ]);
}

function openAccountEditor(item = {}) {
  openEditor("출금계좌", "account", item.id, [
    field("name", "계좌명", "text", item.name, true),
    field("institution", "금융기관명", "text", item.institution),
    selectField("accountType", "계좌 유형", item.accountType || "bank", [["bank", "입출금통장"], ["savings", "적금통장"], ["card", "카드"], ["cash", "현금"], ["etc", "기타"]]),
    field("lastFourDigits", "계좌번호 뒷자리", "text", item.lastFourDigits),
    field("color", "색상", "color", item.color || "#007aff"),
    selectField("isDefault", "기본 계좌", String(item.isDefault || false), [["false", "아님"], ["true", "기본"]]),
    selectField("isActive", "상태", String(item.isActive ?? true), [["true", "활성"], ["false", "비활성"]]),
    textArea("memo", "메모", item.memo)
  ]);
}

function openCategoryEditor(item = {}) {
  openEditor("카테고리", "category", item.id, [
    field("name", "카테고리명", "text", item.name, true),
    selectField("type", "성격", item.type || "expense", [["expense", "지출"], ["saving", "저축"]]),
    selectField("availableTabs", "사용 위치", (item.availableTabs || ["fixed", "variable"]).join(","), [["fixed", "고정지출"], ["variable", "소비지출"], ["fixed,variable", "둘 다"]]),
    field("color", "색상", "color", item.color || "#007aff"),
    field("icon", "아이콘", "text", item.icon || "•"),
    selectField("isActive", "상태", String(item.isActive ?? true), [["true", "활성"], ["false", "비활성"]])
  ]);
  if (item.id) addEditorDeleteButton("카테고리 삭제", "delete-category", item.id);
}

function openGoalEditor(item = {}) {
  openEditor("저축 목표", "goal", item.id, [
    field("name", "목표명", "text", item.name, true),
    field("targetAmount", "목표 금액", "number", item.targetAmount, true),
    field("startDate", "시작일", "date", item.startDate || isoDate(today), true),
    field("endDate", "종료일", "date", item.endDate, true),
    categoryCheckboxes("linkedCategoryIds", "연결할 카테고리", item.linkedCategoryIds || [], "saving"),
    textArea("memo", "메모", item.memo)
  ]);
}

function openEditor(name, handler, id, htmlFields) {
  editorTitle.textContent = `${name} ${id ? "수정" : "추가"}`;
  fields.innerHTML = htmlFields.join("");
  form.querySelector("[data-editor-delete]")?.remove();
  dialog.classList.toggle("bottom-sheet", ["fixed", "goal"].includes(handler));
  form.dataset.handler = handler;
  form.dataset.id = id || "";
  bindNumberInputs(fields);
  dialog.showModal();
}

function addEditorDeleteButton(label, action, id) {
  form.querySelector("[data-editor-delete]")?.remove();
  const button = document.createElement("button");
  button.className = "danger-button";
  button.dataset.editorDelete = "true";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", () => {
    dialog.close();
    handleAction(action, id);
  });
  form.querySelector(".sheet-actions")?.prepend(button);
}

function confirmDelete() {
  return confirm("정말 삭제하시겠습니까?");
}

const handlers = {
  fixed(data, id) {
    const item = {
      id: id || makeId("fixed"),
      name: data.name.trim(),
      amount: parseNumberInput(data.amount),
      categoryId: data.categoryId,
      type: data.type,
      withdrawalAccountId: data.withdrawalAccountId,
      toAccount: data.toAccount.trim(),
      transferType: data.transferType,
      paymentDay: clamp(parseNumberInput(data.paymentDay), 1, 31),
      cycle: data.cycle,
      startDate: data.startDate,
      maturityDate: data.maturityDate,
      autoComplete: data.autoComplete === "true",
      isEnded: data.isEnded === "true",
      memo: data.memo.trim()
    };
    upsert(state.fixedExpenses, item);
  },
  expense(data, id) {
    upsert(state.expenses, {
      id: id || makeId("expense"),
      name: data.name.trim(),
      amount: parseNumberInput(data.amount),
      categoryId: data.categoryId,
      type: data.type,
      date: data.date,
      paymentMethod: data.paymentMethod,
      accountOrCard: data.accountOrCard.trim(),
      memo: data.memo.trim()
    });
  },
  account(data, id) {
    if (data.isDefault === "true") state.accounts.forEach((account) => (account.isDefault = false));
    upsert(state.accounts, {
      id: id || makeId("account"),
      name: data.name.trim(),
      institution: data.institution.trim(),
      accountType: data.accountType,
      lastFourDigits: data.lastFourDigits.trim(),
      isDefault: data.isDefault === "true",
      color: data.color,
      memo: data.memo.trim(),
      isActive: data.isActive === "true"
    });
  },
  category(data, id) {
    upsert(state.categories, {
      id: id || slugify(data.name),
      name: data.name.trim(),
      type: data.type,
      availableTabs: data.availableTabs.split(","),
      color: data.color,
      icon: data.icon.trim(),
      isActive: data.isActive === "true"
    });
  },
  goal(data, id) {
    upsert(state.goals, {
      id: id || makeId("goal"),
      name: data.name.trim(),
      targetAmount: parseNumberInput(data.targetAmount),
      startDate: data.startDate,
      endDate: data.endDate,
      linkedCategoryIds: csv(data.linkedCategoryIds),
      linkedFixedExpenseIds: [],
      initialAmount: 0,
      memo: data.memo.trim()
    });
  }
};

async function toggleFixed(id) {
  const item = findById(state.fixedExpenses, id);
  const targetPeriodKey = spendingPeriodKey();
  const log = getLog(id, targetPeriodKey);
  if (log?.status === "completed") {
    state.fixedLogs = state.fixedLogs.filter((entry) => !(entry.fixedExpenseId === id && entry.periodKey === targetPeriodKey));
    await deleteSupabaseRow("fixed_expense_logs", log.id);
  } else if (log) {
    log.status = "completed";
    log.completedDate = isoDate(today);
    log.actualAmount = Number(item.amount);
  } else {
    state.fixedLogs.push({ id: makeId("log"), fixedExpenseId: id, periodKey: targetPeriodKey, status: "completed", scheduledDate: scheduledDate(item.paymentDay, targetPeriodKey), completedDate: isoDate(today), actualAmount: Number(item.amount), memo: "" });
  }
  saveState();
  render();
}

async function deleteFixedExpense(id) {
  const item = findById(state.fixedExpenses, id);
  if (!item) return;
  if (!confirmDelete()) return;

  closeViewDialog();
  state.fixedExpenses = state.fixedExpenses.filter((entry) => entry.id !== id);
  state.fixedLogs = state.fixedLogs.filter((entry) => entry.fixedExpenseId !== id);
  state.goals.forEach((goal) => {
    goal.linkedFixedExpenseIds = (goal.linkedFixedExpenseIds || []).filter((entryId) => entryId !== id);
  });
  await deleteSupabaseRow("fixed_expenses", id);
  saveState();
  render();
}

async function deleteCategory(id) {
  const category = findById(state.categories, id);
  if (!category) return;
  if (!confirmDelete()) return;

  state.categories = state.categories.filter((entry) => entry.id !== id);
  state.fixedExpenses.forEach((item) => {
    if (item.categoryId === id) item.categoryId = "";
  });
  state.expenses.forEach((item) => {
    if (item.categoryId === id) item.categoryId = "";
  });
  state.goals.forEach((goal) => {
    goal.linkedCategoryIds = (goal.linkedCategoryIds || []).filter((entryId) => entryId !== id);
  });
  Object.keys(state.fixedStatCategories || {}).forEach((key) => {
    state.fixedStatCategories[key] = state.fixedStatCategories[key].filter((entryId) => entryId !== id);
  });
  await deleteSupabaseRow("categories", id);
  saveState();
  render();
}

async function deleteGoal(id) {
  const goal = findById(state.goals, id);
  if (!goal) return;
  if (!confirmDelete()) return;

  closeViewDialog();
  state.goals = state.goals.filter((entry) => entry.id !== id);
  saveState();
  render();
}

function getSummary(targetPeriodKey = periodKey) {
  const fixed = getFixedItemsForPeriod(targetPeriodKey, { includeEnded: false });
  const logs = fixed.map((item) => ({ item, log: getLog(item.id, targetPeriodKey), status: getFixedStatus(item, targetPeriodKey) }));
  const completedFixedExpense = logs.filter(({ item, status }) => item.type === "expense" && status === "completed").reduce((sum, row) => sum + Number(row.log?.actualAmount || row.item.amount), 0);
  const completedFixedSaving = logs.filter(({ item, status }) => item.type === "saving" && status === "completed").reduce((sum, row) => sum + Number(row.log?.actualAmount || row.item.amount), 0);
  const variableExpense = state.expenses.filter((item) => item.type === "expense" && item.date.startsWith(targetPeriodKey)).reduce((sum, item) => sum + Number(item.amount), 0);
  const extraSaving = state.expenses.filter((item) => item.type === "saving" && item.date.startsWith(targetPeriodKey)).reduce((sum, item) => sum + Number(item.amount), 0);
  return {
    planned: fixed.reduce((sum, item) => sum + Number(item.amount), 0),
    completed: logs.filter(({ status }) => status === "completed").reduce((sum, row) => sum + Number(row.log?.actualAmount || row.item.amount), 0),
    pending: logs.filter(({ status }) => status !== "completed").reduce((sum, row) => sum + Number(row.item.amount), 0),
    fixedExpense: fixed.filter((item) => item.type === "expense").reduce((sum, item) => sum + Number(item.amount), 0),
    fixedSaving: fixed.filter((item) => item.type === "saving").reduce((sum, item) => sum + Number(item.amount), 0),
    auto: fixed.filter((item) => item.transferType === "auto").reduce((sum, item) => sum + Number(item.amount), 0),
    manual: fixed.filter((item) => item.transferType === "manual").reduce((sum, item) => sum + Number(item.amount), 0),
    completedFixedSaving,
    totalExpense: completedFixedExpense + variableExpense,
    totalSaving: completedFixedSaving + extraSaving,
    variableExpense,
    extraSaving
  };
}

function getFixedItemsForPeriod(targetPeriodKey = periodKey, options = {}) {
  const { includeEnded = false } = options;
  return state.fixedExpenses
    .filter((item) => includeEnded || !isFixedEnded(item))
    .filter((item) => isFixedInPeriod(item, targetPeriodKey))
    .map((item) => ({ ...item, log: getLog(item.id, targetPeriodKey), status: getFixedStatus(item, targetPeriodKey) }))
    .sort((a, b) => Number(a.paymentDay || 1) - Number(b.paymentDay || 1) || a.name.localeCompare(b.name, "ko"));
}

function getEndedFixedItems() {
  return state.fixedExpenses
    .filter(isFixedEnded)
    .map((item) => ({ ...item, log: getLog(item.id, spendingPeriodKey()), status: getFixedStatus(item, spendingPeriodKey()) }))
    .sort((a, b) => Number(a.paymentDay || 1) - Number(b.paymentDay || 1) || a.name.localeCompare(b.name, "ko"));
}

function isFixedInPeriod(item, targetPeriodKey) {
  const scheduled = scheduledDate(item.paymentDay || 1, targetPeriodKey);
  if (item.startDate && scheduled < item.startDate) return false;
  if (item.maturityDate && scheduled > item.maturityDate) return false;
  return true;
}

function isFixedEnded(item) {
  return Boolean(item.isEnded) || isMaturedFixed(item);
}

function isMaturedFixed(item) {
  return Boolean(item.maturityDate && item.maturityDate < isoDate(today));
}

function getFixedItemsForDate(dateKey) {
  const targetPeriodKey = dateKey.slice(0, 7);
  const day = Number(dateKey.slice(-2));
  return getFixedItemsForPeriod(targetPeriodKey)
    .filter((item) => Number(item.paymentDay) === day)
    .sort((a, b) => Number(a.paymentDay || 1) - Number(b.paymentDay || 1) || a.name.localeCompare(b.name, "ko"));
}

function fixedCalendarCounts(targetPeriodKey) {
  const counts = {};
  getFixedItemsForPeriod(targetPeriodKey).forEach((item) => {
    const dateKey = scheduledDate(item.paymentDay || 1, targetPeriodKey);
    counts[dateKey] = (counts[dateKey] || 0) + 1;
  });
  return counts;
}

function getFixedStatItems(statKey, targetPeriodKey = periodKey) {
  const items = getFixedItemsForPeriod(targetPeriodKey);
  const linkedCategories = getStatCategoryIds(statKey);
  return items.filter((item) => linkedCategories.includes(item.categoryId));
}

function getStatCategoryIds(statKey) {
  const defaults = defaultState.fixedStatCategories[statKey] || [];
  return state.fixedStatCategories?.[statKey] || defaults;
}

function statLabelMap() {
  return Object.fromEntries(fixedStatDefinitions().map((item) => [item.key, item.label]));
}

function categoryTotals(type, targetPeriodKey = periodKey) {
  const map = new Map();
  state.categories.filter((category) => category.type === type).forEach((category) => map.set(category.id, { label: category.name, color: category.color, value: 0 }));
  state.fixedExpenses.forEach((item) => {
    if (item.type !== type || getFixedStatus(item, targetPeriodKey) !== "completed") return;
    const entry = map.get(item.categoryId);
    if (entry) entry.value += Number(item.amount);
  });
  state.expenses.forEach((item) => {
    if (item.type !== type || !item.date.startsWith(targetPeriodKey)) return;
    const entry = map.get(item.categoryId);
    if (entry) entry.value += Number(item.amount);
  });
  return [...map.values()].filter((entry) => entry.value > 0);
}

function goalSavedAmount(goal) {
  const linkedCategories = new Set(goal.linkedCategoryIds || []);
  const linkedFixed = new Set(goal.linkedFixedExpenseIds || []);
  const fixedSaving = state.fixedExpenses
    .filter((item) => item.type === "saving" && (linkedFixed.has(item.id) || linkedCategories.has(item.categoryId)) && getFixedStatus(item) === "completed")
    .reduce((sum, item) => sum + Number(item.amount), 0);
  const variableSaving = state.expenses
    .filter((item) => item.type === "saving" && linkedCategories.has(item.categoryId))
    .reduce((sum, item) => sum + Number(item.amount), 0);
  return Number(goal.initialAmount || 0) + fixedSaving + variableSaving;
}

function goalContributionItems(goal) {
  const linkedCategories = new Set(goal.linkedCategoryIds || []);
  const linkedFixed = new Set(goal.linkedFixedExpenseIds || []);
  const fixedItems = state.fixedExpenses
    .filter((item) => item.type === "saving" && (linkedFixed.has(item.id) || linkedCategories.has(item.categoryId)) && getFixedStatus(item) === "completed")
    .map((item) => {
      const log = getLog(item.id);
      return {
        date: log?.completedDate || log?.scheduledDate || scheduledDate(item.paymentDay),
        name: item.name,
        amount: Number(log?.actualAmount || item.amount),
        source: "고정지출"
      };
    });
  const variableItems = state.expenses
    .filter((item) => item.type === "saving" && linkedCategories.has(item.categoryId))
    .map((item) => ({ date: item.date, name: item.name, amount: Number(item.amount), source: "소비지출" }));
  return [...fixedItems, ...variableItems].sort((a, b) => b.date.localeCompare(a.date));
}

function goalCategoryNames(goal) {
  return (goal.linkedCategoryIds || []).map((id) => findById(state.categories, id)?.name).filter(Boolean);
}

function getGoalState(goal) {
  const saved = goalSavedAmount(goal);
  if (saved >= Number(goal.targetAmount || 0)) return "completed";
  if (goal.endDate && goal.endDate < isoDate(today)) return "failed";
  return "active";
}

function daysUntil(dateText) {
  const end = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(end.getTime())) return 0;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.ceil((end - start) / 86400000));
}

function formatGoalDate(dateText) {
  if (!dateText) return "";
  const [year, month, day] = dateText.split("-");
  return `${String(year).slice(2)}.${month}.${day}`;
}

function getTotalSaved() {
  return state.goals.reduce((sum, goal) => sum + goalSavedAmount(goal), 0);
}

function summaryCard(label, total, periodLabel, metrics) {
  return `
    <section class="summary-card">
      <div class="summary-main">
        <div><p class="muted">${label}</p><p class="amount-xl">${typeof total === "number" ? money(total) : total}</p></div>
        <span class="pill blue">${periodLabel}</span>
      </div>
      <div class="summary-grid">
        ${metrics.map(([name, value]) => `<div class="metric"><span>${name}</span><strong>${typeof value === "number" ? money(value) : value}</strong></div>`).join("")}
      </div>
    </section>
  `;
}

function statTile(label, value) {
  return `
    <div class="stat-tile">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function segments(group, value, options) {
  return `<div class="segmented">${options.map(([key, label]) => `<button class="segment ${value === key ? "active" : ""}" data-segment-group="${group}" data-value="${key}" type="button">${label}</button>`).join("")}</div>`;
}

function sectionSwitcher(group, value, options) {
  return `<div class="toolbar">${segments(group, value, options)}</div>`;
}

function chartRows(items) {
  if (!items.length) return empty("표시할 데이터가 없습니다.");
  const max = Math.max(...items.map((item) => item.value), 1);
  return items.map((item) => `
    <div class="chart-row">
      <span class="muted">${escapeHtml(item.label)}</span>
      <div class="bar"><div class="bar-fill" style="width:${Math.max(4, Math.round((item.value / max) * 100))}%; background:${item.color || "var(--blue)"}"></div></div>
      <strong>${money(item.value)}</strong>
    </div>
  `).join("");
}

function field(name, label, type, value = "", required = false, min = "", max = "") {
  if (type === "number") {
    return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="text" inputmode="numeric" data-number-format="true" value="${escapeAttr(formatInputNumber(value || ""))}" ${required ? "required" : ""} ${min ? `data-min="${min}"` : ""} ${max ? `data-max="${max}"` : ""}></div>`;
  }
  return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${escapeAttr(value || "")}" ${required ? "required" : ""} ${min ? `min="${min}"` : ""} ${max ? `max="${max}"` : ""}></div>`;
}

function textArea(name, label, value = "") {
  return `<div class="field"><label for="${name}">${label}</label><textarea id="${name}" name="${name}">${escapeHtml(value || "")}</textarea></div>`;
}

function selectField(name, label, value, options) {
  return `<div class="field"><label for="${name}">${label}</label><select id="${name}" name="${name}">${options.map(([key, text]) => `<option value="${escapeAttr(key)}" ${String(value) === String(key) ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select></div>`;
}

function categoryCheckboxes(name, label, selectedIds = [], type = "saving") {
  const selected = new Set(selectedIds || []);
  const categories = state.categories.filter((category) => category.isActive && category.type === type);
  return `
    <div class="field">
      <span class="field-label">${label}</span>
      <div class="form-check-list">
        ${categories.length ? categories.map((category) => `
          <label class="form-check-row">
            <input name="${name}" type="checkbox" value="${category.id}" ${selected.has(category.id) ? "checked" : ""}>
            <span class="color-dot" style="--dot:${category.color || "#8e8e93"}"></span>
            <span>${escapeHtml(category.name)}</span>
          </label>
        `).join("") : `<p class="form-help">설정 탭에서 카테고리를 먼저 추가해주세요.</p>`}
      </div>
    </div>
  `;
}

function bindNumberInputs(root) {
  root.querySelectorAll("[data-number-format]").forEach((input) => {
    input.value = formatInputNumber(input.value);
    input.addEventListener("input", () => {
      const cursorFromEnd = input.value.length - input.selectionStart;
      input.value = formatInputNumber(input.value);
      const nextPosition = Math.max(0, input.value.length - cursorFromEnd);
      input.setSelectionRange(nextPosition, nextPosition);
    });
  });
}

function accountOptions() {
  return state.accounts.filter((item) => item.isActive).map((item) => [item.id, `${item.name} (${item.institution || "기관 없음"})`]);
}

function categoryOptions(tab) {
  return [["", "미분류"], ...state.categories.filter((item) => item.isActive && item.availableTabs.includes(tab)).map((item) => [item.id, `${item.icon || ""} ${item.name}`])];
}

function getFixedStatus(item, targetPeriodKey = periodKey) {
  const log = getLog(item.id, targetPeriodKey);
  if (log) return log.status;
  if (targetPeriodKey < periodKey) return "pending";
  if (targetPeriodKey > periodKey) return "scheduled";
  return Number(item.paymentDay) < today.getDate() ? "pending" : "scheduled";
}

function getLog(fixedExpenseId, targetPeriodKey = periodKey) {
  return state.fixedLogs.find((log) => log.fixedExpenseId === fixedExpenseId && log.periodKey === targetPeriodKey);
}

function scheduledDate(day, targetPeriodKey = periodKey) {
  return `${targetPeriodKey}-${String(day).padStart(2, "0")}`;
}

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function money(value) {
  return `${new Intl.NumberFormat("ko-KR").format(Number(value || 0))}원`;
}

function parseNumberInput(value) {
  return Number(String(value || "").replace(/,/g, "")) || 0;
}

function formatInputNumber(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  return digits ? new Intl.NumberFormat("ko-KR").format(Number(digits)) : "";
}

function typeLabel(value) {
  return value === "saving" ? "저축" : "지출";
}

function transferLabel(value) {
  return { auto: "자동이체", manual: "직접 납부", unset: "미설정" }[value] || "미설정";
}

function statusLabel(value, log) {
  if (value === "completed") return `${log?.completedDate || ""} 완료`;
  return { pending: "이번 달 미완료", scheduled: "출금 예정", skipped: "건너뜀" }[value] || "예정";
}

function paymentLabel(value) {
  return { card: "카드", cash: "현금", transfer: "계좌이체", etc: "기타" }[value] || "기타";
}

function formatShortDate(dateText) {
  if (!dateText) return "";
  const [, month, day] = dateText.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
}

function accountTypeLabel(value) {
  return { bank: "입출금통장", savings: "적금통장", card: "카드", cash: "현금", etc: "기타" }[value] || "기타";
}

function availableLabel(values) {
  const joined = (values || []).join(",");
  return { fixed: "고정지출용", variable: "소비지출용", "fixed,variable": "고정지출 · 소비지출" }[joined] || "사용 위치 미설정";
}

function empty(message) {
  return `<p class="empty">${message}</p>`;
}

function findById(items, id) {
  return items.find((item) => item.id === id);
}

function upsert(items, item) {
  const index = items.findIndex((entry) => entry.id === item.id);
  if (index >= 0) items[index] = item;
  else items.unshift(item);
}

function defaultAccountId() {
  return state.accounts.find((account) => account.isDefault)?.id || state.accounts[0]?.id || "";
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function slugify(value) {
  return value.trim().toLowerCase().replace(/\s+/g, "_") || makeId("category");
}

function csv(value = "") {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function sumValues(items) {
  return items.reduce((sum, item) => sum + Number(item.value), 0);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
}

function monthsUntil(dateText) {
  const end = new Date(dateText);
  if (Number.isNaN(end.getTime())) return 1;
  return Math.max(1, (end.getFullYear() - today.getFullYear()) * 12 + end.getMonth() - today.getMonth() + 1);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function getCurrentPage() {
  const file = location.pathname.split("/").pop() || "index.html";
  if (file === "insights.html") return "insights";
  if (file === "settings.html") return "settings";
  return "spending";
}

function spendingPeriodKey() {
  return toPeriodKey(addMonths(today, spendingCalendarOffset));
}

function calendarCard() {
  const monthDate = addMonths(today, spendingCalendarOffset);
  const key = toPeriodKey(monthDate);
  const days = buildCalendarDays(monthDate);
  const counts = calendarCounts(key);
  return `
    <section class="calendar-card">
      <div class="calendar-head">
        <div>
          <p class="muted">${monthDate.getFullYear()}년</p>
          <h2>${monthDate.getMonth() + 1}월 달력</h2>
        </div>
        <div class="toolbar">
          <button class="icon-button" data-calendar-nav="-1" type="button" aria-label="이전 달">${lineIcon("chevronLeft")}</button>
          <button class="icon-button" data-calendar-nav="1" type="button" aria-label="다음 달">${lineIcon("chevronRight")}</button>
        </div>
      </div>
      <div class="calendar-grid calendar-weekdays" aria-hidden="true">
        ${["일", "월", "화", "수", "목", "금", "토"].map((day) => `<div>${day}</div>`).join("")}
      </div>
      <div class="calendar-grid">
        ${days.map((day) => {
          const dateKey = toDateKey(day.date);
          const inMonth = day.date.getMonth() === monthDate.getMonth();
          const isToday = dateKey === toDateKey(today);
          const dayCount = counts[dateKey] || 0;
          return `
            <button class="calendar-day ${inMonth ? "" : "dim"} ${isToday ? "today" : ""}" type="button" aria-label="${dateKey}">
              <span>${day.date.getDate()}</span>
              ${dayCount ? `<em>${dayCount}</em>` : ""}
            </button>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function calendarCounts(targetPeriodKey) {
  const counts = {};
  state.fixedExpenses.forEach((item) => {
    const log = getLog(item.id, targetPeriodKey);
    if (!log && Number(item.paymentDay)) {
      const dateKey = `${targetPeriodKey}-${String(item.paymentDay).padStart(2, "0")}`;
      counts[dateKey] = (counts[dateKey] || 0) + 1;
    } else if (log) {
      counts[log.scheduledDate] = (counts[log.scheduledDate] || 0) + 1;
    }
  });
  state.expenses.forEach((item) => {
    if (!item.date.startsWith(targetPeriodKey)) return;
    counts[item.date] = (counts[item.date] || 0) + 1;
  });
  return counts;
}

function buildCalendarDays(monthDate) {
  const start = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const end = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const startOffset = start.getDay();
  const visibleStart = new Date(start);
  visibleStart.setDate(start.getDate() - startOffset);
  const totalCells = 42;
  return Array.from({ length: totalCells }, (_, index) => {
    const date = new Date(visibleStart);
    date.setDate(visibleStart.getDate() + index);
    return { date, inMonth: date.getMonth() === monthDate.getMonth() };
  });
}

function addMonths(baseDate, offset) {
  return new Date(baseDate.getFullYear(), baseDate.getMonth() + offset, 1);
}

function toPeriodKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

renderAuth("로그인 상태를 확인하고 있습니다.");
initSupabase();

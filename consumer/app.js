const PAGE_SIZE = 20;

const state = { status: "", offset: 0 };
const filterEl = document.getElementById("filter");
const rowsEl = document.getElementById("rows");
const summaryEl = document.getElementById("summary");
const pageinfoEl = document.getElementById("pageinfo");
const prevEl = document.getElementById("prev");
const nextEl = document.getElementById("next");
const errorEl = document.getElementById("error");

function apiTarget() {
  const q = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(state.offset) });
  if (state.status) q.set("status", state.status);
  return `/api/v1/verification-requests?${q.toString()}`;
}

async function load() {
  errorEl.textContent = "";
  nextEl.disabled = true;
  prevEl.disabled = true;
  pageinfoEl.textContent = "Loading…";
  try {
    const res = await fetch(`/proxy?target=${encodeURIComponent(apiTarget())}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);

    rowsEl.innerHTML = "";
    for (const r of body.data) {
      const tr = document.createElement("tr");
      for (const cell of [r.id, r.userId, r.status, new Date(r.createdAt).toLocaleString()]) {
        const td = document.createElement("td");
        td.textContent = cell;
        tr.append(td);
      }
      rowsEl.append(tr);
    }

    const { total, limit, offset, hasMore } = body.meta;
    const first = total === 0 ? 0 : offset + 1;
    const last = Math.min(total, offset + limit);
    summaryEl.textContent = `filter "${state.status || "all"}": ${total} total`;
    pageinfoEl.textContent = `${first}-${last} of ${total} · page ${offset / PAGE_SIZE + 1}`;
    nextEl.disabled = !hasMore;
    prevEl.disabled = offset === 0;
  } catch (err) {
    errorEl.textContent = String(err?.message ?? err);
  }
}

filterEl.addEventListener("change", () => {
  state.status = filterEl.value;
  state.offset = 0;
  load();
});
nextEl.addEventListener("click", () => {
  state.offset += PAGE_SIZE;
  load();
});
prevEl.addEventListener("click", () => {
  state.offset = Math.max(0, state.offset - PAGE_SIZE);
  load();
});

load();
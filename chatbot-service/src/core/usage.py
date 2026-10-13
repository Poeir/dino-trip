"""Per-request LLM token accounting.

One UsageTracker per chat turn or trip plan, passed explicitly to every LLM
call site (not a contextvar: chat_stream is a sync generator that Starlette
iterates across threadpool hops, which would lose a contextvar between
chunks). Each call's `response.usage` is recorded with a label; `finish()`
logs one summary line and appends one JSONL record for scripts/usage_report.py.
"""
import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path

from src.core.config import LLM_PRICE_INPUT_PER_M, LLM_PRICE_OUTPUT_PER_M, USAGE_LOG_PATH

logger = logging.getLogger(__name__)

_write_lock = threading.Lock()


def _as_int(value) -> int:
    return value if isinstance(value, int) else 0


def _billed_output(prompt: int, completion: int, total: int) -> int:
    """Output tokens as billed. Gemini's "thinking" tokens are billed as
    output, but depending on the gateway they're either already inside
    completion_tokens or reported only via total_tokens. Taking the larger of
    completion_tokens and (total - prompt) covers both."""
    return max(completion, total - prompt) if total else completion


class UsageTracker:
    def __init__(self, scope: str, **meta):
        self.scope = scope  # "chat" | "trip"
        self.meta = meta
        self.calls: list[dict] = []
        self._lock = threading.Lock()

    def record(self, label: str, model: str, usage) -> None:
        """`usage` is the OpenAI-style usage object (or None -- some gateways
        omit it, notably on streams without include_usage). A call with no
        usage is still counted so `missing_usage` shows the numbers are low."""
        entry = {"label": label, "model": model, "input": 0, "output": 0, "reasoning": 0, "usage_missing": usage is None}
        if usage is not None:
            prompt = _as_int(getattr(usage, "prompt_tokens", 0))
            completion = _as_int(getattr(usage, "completion_tokens", 0))
            total = _as_int(getattr(usage, "total_tokens", 0))
            details = getattr(usage, "completion_tokens_details", None)
            entry["input"] = prompt
            entry["output"] = _billed_output(prompt, completion, total)
            entry["reasoning"] = _as_int(getattr(details, "reasoning_tokens", 0)) if details else 0
        with self._lock:
            self.calls.append(entry)

    def record_response(self, label: str, model: str, response) -> None:
        self.record(label, model, getattr(response, "usage", None))

    def summary(self) -> dict:
        with self._lock:
            calls = list(self.calls)
        by_label: dict[str, dict] = {}
        for c in calls:
            b = by_label.setdefault(c["label"], {"calls": 0, "input": 0, "output": 0})
            b["calls"] += 1
            b["input"] += c["input"]
            b["output"] += c["output"]
        total_in = sum(c["input"] for c in calls)
        total_out = sum(c["output"] for c in calls)
        cost = total_in * LLM_PRICE_INPUT_PER_M / 1e6 + total_out * LLM_PRICE_OUTPUT_PER_M / 1e6
        return {
            "llm_calls": len(calls),
            "input_tokens": total_in,
            "output_tokens": total_out,
            "reasoning_tokens": sum(c["reasoning"] for c in calls),
            "cost_usd": round(cost, 6),
            "missing_usage": sum(1 for c in calls if c["usage_missing"]),
            "by_label": by_label,
        }

    def finish(self) -> dict:
        """Logs + persists the summary; safe to call once per request. Never
        raises -- accounting must not break a chat or trip response."""
        summary = self.summary()
        try:
            logger.info(
                "usage scope=%s calls=%d input=%d output=%d (reasoning=%d) cost_usd=%.5f missing=%d meta=%s",
                self.scope, summary["llm_calls"], summary["input_tokens"], summary["output_tokens"],
                summary["reasoning_tokens"], summary["cost_usd"], summary["missing_usage"], self.meta,
            )
            if USAGE_LOG_PATH:
                record = {
                    "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "scope": self.scope,
                    **self.meta,
                    **summary,
                    "calls": self.calls,
                }
                path = Path(USAGE_LOG_PATH)
                with _write_lock:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    with path.open("a", encoding="utf-8") as f:
                        f.write(json.dumps(record, ensure_ascii=False) + "\n")
        except Exception as e:
            logger.warning("usage tracking failed: %s", e)
        return summary

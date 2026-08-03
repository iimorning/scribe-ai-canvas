mod local_llama;

use futures_util::StreamExt;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use local_llama::LocalLlamaChatPayload;

/// OpenAI-compatible POST to `url` (e.g. Xiaomi MiMo Token Plan: https://token-plan-cn.xiaomimimo.com/v1/chat/completions).
/// Bypasses browser CORS when running in the Tauri webview.
#[tauri::command]
async fn openai_compatible_chat(api_key: String, url: String, body: Value) -> Result<String, String> {
  let client = reqwest::Client::builder()
    .build()
    .map_err(|e| e.to_string())?;
  openai_compatible_chat_inner(&client, &api_key, &url, body).await
}

/// HTTP body extracted as a `pub(crate)` helper so the integration tests can
/// call it directly with a local reqwest client and a mock HTTP server.
pub async fn openai_compatible_chat_inner(
  client: &reqwest::Client,
  api_key: &str,
  url: &str,
  body: Value,
) -> Result<String, String> {
  let response = client
    .post(url)
    .header("Authorization", format!("Bearer {api_key}"))
    .header("Content-Type", "application/json")
    .json(&body)
    .send()
    .await
    .map_err(|e| {
      eprintln!("[Spoor] openai_compatible_chat network error: {e} (url={url})");
      e.to_string()
    })?;

  let status = response.status();
  let text = response.text().await.map_err(|e| e.to_string())?;

  if !status.is_success() {
    let preview: String = text.chars().take(800).collect();
    eprintln!("[Spoor] openai_compatible_chat HTTP {status} url={url} body_preview={preview}");
    return Err(text);
  }

  let json: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
  let content = json["choices"]
    .get(0)
    .and_then(|c| c.get("message")?.get("content"));

  match content {
    Some(Value::String(s)) => Ok(s.clone()),
    Some(v) => Ok(v.to_string()),
    None => Err(format!("Unexpected API response: {text}")),
  }
}

/// Same as [`openai_compatible_chat`] but `stream: true` + SSE; emits JSON `{ id, text }` on `lab-ai-stream` as tokens arrive.
#[tauri::command]
async fn openai_compatible_chat_stream(
  app: AppHandle,
  api_key: String,
  url: String,
  mut body: Value,
  stream_id: String,
) -> Result<String, String> {
  let client = reqwest::Client::builder()
    .build()
    .map_err(|e| e.to_string())?;

  if let Some(obj) = body.as_object_mut() {
    obj.insert("stream".to_string(), Value::Bool(true));
  }

  let response = client
    .post(&url)
    .header(
      "Authorization",
      format!("Bearer {}", api_key.trim()),
    )
    .header("Content-Type", "application/json")
    .json(&body)
    .send()
    .await
    .map_err(|e| {
      eprintln!("[Spoor] openai_compatible_chat_stream network error: {e} (url={url})");
      e.to_string()
    })?;

  let status = response.status();
  if !status.is_success() {
    let text = response.text().await.unwrap_or_default();
    let preview: String = text.chars().take(800).collect();
    eprintln!(
      "[Spoor] openai_compatible_chat_stream HTTP {status} url={url} body_preview={preview}"
    );
    return Err(text);
  }

  let mut stream = response.bytes_stream();
  let mut pending = String::new();
  let mut full = String::new();

  while let Some(chunk_result) = stream.next().await {
    let chunk = chunk_result.map_err(|e| e.to_string())?;
    pending.push_str(&String::from_utf8_lossy(&chunk));

    loop {
      let nl = match pending.find('\n') {
        Some(i) => i,
        None => break,
      };
      let line = pending[..nl].trim_end_matches('\r').to_string();
      pending = pending[nl + 1..].to_string();

      if let Some(delta) = parse_sse_chunk(&line) {
        if !delta.is_empty() {
          full.push_str(&delta);
          let payload = serde_json::json!({ "id": &stream_id, "text": &full });
          let _ = app.emit("lab-ai-stream", payload);
        }
      }
    }
  }

  Ok(full)
}

/// Extracts the content delta from a single SSE `data:` line.
/// Returns `Some(delta)` for valid data lines (including empty content),
/// `None` for non-data lines, comments, or the `[DONE]` sentinel.
pub fn parse_sse_chunk(line: &str) -> Option<String> {
  let trimmed = line.trim();
  let data = trimmed.strip_prefix("data:")?.trim_start();
  if data == "[DONE]" {
    return None;
  }
  let v: Value = serde_json::from_str(data).ok()?;
  let delta = v["choices"]
    .get(0)
    .and_then(|c| c.get("delta"))
    .and_then(|d| d.get("content"))
    .and_then(|c| c.as_str())?;
  Some(delta.to_string())
}

/// Metaso (秘塔) search API proxy.
/// POST https://metaso.cn/api/v1/search — bypasses browser CORS in Tauri webview.
/// `scope`: webpage | image | video | podcast (default webpage). `size`: 1–20 (default 5).
#[tauri::command]
async fn metaso_search(
    api_key: String,
    query: String,
    scope: Option<String>,
    size: Option<u32>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;
    metaso_search_inner(&client, &api_key, &query, scope, size, METASO_BASE_URL).await
}

/// Default base URL for Metaso. Exposed as a const so the test suite can use
/// the same value in error-message expectations.
pub const METASO_BASE_URL: &str = "https://metaso.cn/api/v1/search";

/// HTTP body of `metaso_search` extracted as a `pub` helper for integration
/// testing. The `base_url` is the full Metaso endpoint URL — the production
/// command passes [`METASO_BASE_URL`]; tests can inject a local mock server.
pub async fn metaso_search_inner(
    client: &reqwest::Client,
    api_key: &str,
    query: &str,
    scope: Option<String>,
    size: Option<u32>,
    base_url: &str,
) -> Result<String, String> {
    let (scope, size) = normalize_metaso_params(scope, size);

    let body = serde_json::json!({
        "q": query,
        "scope": scope,
        "size": size,
    });

    let response = client
        .post(base_url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            eprintln!("[Spoor] metaso_search network error: {e}");
            e.to_string()
        })?;

    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        let preview: String = text.chars().take(800).collect();
        eprintln!("[Spoor] metaso_search HTTP {status} body_preview={preview}");
        return Err(text);
    }

    Ok(text)
}

/// Pure helper: normalizes the optional `scope` and `size` parameters for Metaso.
/// `scope`: "image" | "video" | "podcast" pass through (after trim); anything else → "webpage".
/// `size`: defaults to 5, clamped to [1, 20].
pub fn normalize_metaso_params(scope: Option<String>, size: Option<u32>) -> (String, u32) {
    let scope = match scope.as_deref().map(str::trim).unwrap_or("webpage") {
        "image" => "image",
        "video" => "video",
        "podcast" => "podcast",
        _ => "webpage",
    };
    let size = size.unwrap_or(5).clamp(1, 20);
    (scope.to_string(), size)
}

/// Validate a URL for `open_external_url`: trims, requires `http://` or `https://` prefix.
pub fn open_external_url_validate(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("Only http:// and https:// URLs are allowed".into());
    }
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("Only http:// and https:// URLs are allowed".into());
    }
    Ok(trimmed.to_string())
}

/// Open an http(s) URL in the system default browser. Webview `target=_blank` is unreliable in Tauri.
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let validated = open_external_url_validate(&url)?;
    open::that(validated).map_err(|e| e.to_string())
}

/// 内置 llama.cpp：加载本地 GGUF，使用模型自带 chat 模板完成一轮对话（桌面端离线）。
#[tauri::command]
async fn local_llama_chat(payload: LocalLlamaChatPayload) -> Result<String, String> {
  tokio::task::spawn_blocking(move || local_llama::chat(payload))
    .await
    .map_err(|e| format!("推理任务异常: {e}"))?
}

/// 返回本地 LLM 日志文件路径（每次推理的命令行/stdout/stderr/耗时都会写入此文件）。
#[tauri::command]
fn get_local_llama_log_path() -> String {
  local_llama::log_path().to_string_lossy().to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      openai_compatible_chat,
      openai_compatible_chat_stream,
      metaso_search,
      open_external_url,
      local_llama_chat,
      get_local_llama_log_path
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

//! Integration tests for `src-tauri/src/lib.rs`.
//!
//! The Tauri commands delegate to `pub` helpers (extracted into `lib.rs`
//! for testability). These tests exercise the helpers directly using a tiny
//! in-process HTTP server built on `tokio::net::TcpListener` so no extra
//! dev-dependencies are required.

use serde_json::{json, Value};
use spoor_lib::{
  metaso_search_inner, normalize_metaso_params, open_external_url_validate,
  openai_compatible_chat_inner, parse_sse_chunk, METASO_BASE_URL,
};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

// ---------- HTTP test server scaffolding ----------

/// A scripted HTTP response for the fake server.
#[derive(Clone)]
struct ScriptedResponse {
  status: u16,
  reason: &'static str,
  content_type: &'static str,
  body: String,
}

impl ScriptedResponse {
  fn json(status: u16, body: Value) -> Self {
    Self {
      status,
      reason: if status < 300 { "OK" } else { "Internal Server Error" },
      content_type: "application/json",
      body: body.to_string(),
    }
  }
  fn raw(status: u16, body: impl Into<String>) -> Self {
    Self {
      status,
      reason: if status < 300 { "OK" } else { "Internal Server Error" },
      content_type: "text/plain",
      body: body.into(),
    }
  }
}

/// Starts a fake HTTP server that returns a single scripted response for the
/// first request and 404 thereafter. Returns the base URL (path is `/`) and a
/// handle to the captured raw request (so tests can assert headers + body).
async fn spawn_scripted_server(resp: ScriptedResponse) -> (String, Arc<Mutex<Option<String>>>) {
  let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
  let addr = listener.local_addr().expect("local_addr");
  let captured: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
  let cap = Arc::clone(&captured);
  let resp_clone = resp.clone();

  tokio::spawn(async move {
    if let Ok((mut sock, _)) = listener.accept().await {
      // Read the request fully (up to 8 KiB — more than enough for our tests)
      let mut buf = vec![0u8; 8192];
      let mut total = 0;
      loop {
        match sock.read(&mut buf[total..]).await {
          Ok(0) => break,
          Ok(n) => {
            total += n;
            // Stop after the headers + a body marker; Content-Length=0 cases
            // also work because we look for "\r\n\r\n"
            if buf[..total].windows(4).any(|w| w == b"\r\n\r\n") {
              break;
            }
            if total >= buf.len() {
              break;
            }
          }
          Err(_) => break,
        }
      }
      {
        let mut g = cap.lock().await;
        *g = Some(String::from_utf8_lossy(&buf[..total]).to_string());
      }

      // Build a minimal HTTP/1.1 response.
      let body = resp_clone.body;
      let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {ct}\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n{body}",
        status = resp_clone.status,
        reason = resp_clone.reason,
        ct = resp_clone.content_type,
        len = body.len(),
      );
      let _ = sock.write_all(response.as_bytes()).await;
      let _ = sock.shutdown().await;
    }
  });

  // Return the base URL with root path — tests can append their own path
  (format!("http://{}/", addr), captured)
}

// ---------- openai_compatible_chat_inner ----------

#[tokio::test]
async fn chat_inner_returns_string_content() {
  let resp = ScriptedResponse::json(
    200,
    json!({"choices": [{"message": {"content": "Hello!"}}]}),
  );
  let (base, _cap) = spawn_scripted_server(resp).await;
  let client = reqwest::Client::new();
  let url = format!("{base}v1/chat");
  let r = openai_compatible_chat_inner(&client, "k", &url, json!({})).await.unwrap();
  assert_eq!(r, "Hello!");
}

#[tokio::test]
async fn chat_inner_stringifies_non_string_content() {
  let resp = ScriptedResponse::json(200, json!({"choices": [{"message": {"content": 123}}]}));
  let (base, _cap) = spawn_scripted_server(resp).await;
  let client = reqwest::Client::new();
  let r = openai_compatible_chat_inner(&client, "k", &format!("{base}v1/chat"), json!({}))
    .await
    .unwrap();
  assert_eq!(r, "123");
}

#[tokio::test]
async fn chat_inner_missing_content_returns_unexpected_error() {
  let resp = ScriptedResponse::json(200, json!({"choices": [{}]}));
  let (base, _cap) = spawn_scripted_server(resp).await;
  let client = reqwest::Client::new();
  let err = openai_compatible_chat_inner(&client, "k", &format!("{base}v1/chat"), json!({}))
    .await
    .unwrap_err();
  assert!(err.contains("Unexpected API response"), "got: {err}");
}

#[tokio::test]
async fn chat_inner_http_401_propagates_body() {
  let resp = ScriptedResponse::raw(401, "auth failed");
  let (base, _cap) = spawn_scripted_server(resp).await;
  let client = reqwest::Client::new();
  let err = openai_compatible_chat_inner(&client, "k", &format!("{base}v1/chat"), json!({}))
    .await
    .unwrap_err();
  assert!(err.contains("auth failed"), "got: {err}");
}

#[tokio::test]
async fn chat_inner_http_500_returns_full_body_as_error() {
  let body = "X".repeat(1000);
  let resp = ScriptedResponse::raw(500, body.clone());
  let (base, _cap) = spawn_scripted_server(resp).await;
  let client = reqwest::Client::new();
  // The function returns the FULL body as the error (truncation is only in the
  // eprintln log). The body returned is the full text. Verify that.
  let err = openai_compatible_chat_inner(&client, "k", &format!("{base}v1/chat"), json!({}))
    .await
    .unwrap_err();
  assert_eq!(err.len(), 1000);
}

#[tokio::test]
async fn chat_inner_sets_authorization_and_content_type_headers() {
  let resp = ScriptedResponse::json(200, json!({"choices": [{"message": {"content": "ok"}}]}));
  let (base, cap) = spawn_scripted_server(resp).await;
  let client = reqwest::Client::new();
  let _ = openai_compatible_chat_inner(&client, "my-key", &format!("{base}v1/chat"), json!({}))
    .await;
  let req = cap.lock().await.clone().expect("captured request");
  // reqwest sends headers lowercase
  assert!(
    req.contains("authorization: Bearer my-key"),
    "missing auth header: {req}"
  );
  assert!(
    req.contains("content-type: application/json"),
    "missing content-type: {req}"
  );
}

#[tokio::test]
async fn chat_inner_sends_request_body_as_json() {
  let resp = ScriptedResponse::json(200, json!({"choices": [{"message": {"content": "ok"}}]}));
  let (base, cap) = spawn_scripted_server(resp).await;
  let client = reqwest::Client::new();
  let body = json!({"model": "x", "messages": [{"role": "user", "content": "hi"}]});
  let _ = openai_compatible_chat_inner(&client, "k", &format!("{base}v1/chat"), body.clone())
    .await;
  let req = cap.lock().await.clone().expect("captured request");
  // The body is at the end of the request after the empty line
  let body_str = req.split("\r\n\r\n").nth(1).unwrap_or("");
  let parsed: Value = serde_json::from_str(body_str).expect("body parses as JSON");
  assert_eq!(parsed, body);
}

#[tokio::test]
async fn chat_inner_network_error_is_reported() {
  // 127.0.0.1:1 is reserved and refuses connections
  let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(2))
    .build()
    .unwrap();
  let err = openai_compatible_chat_inner(&client, "k", "http://127.0.0.1:1/", json!({}))
    .await
    .unwrap_err();
  assert!(!err.is_empty(), "expected a non-empty error");
}

// ---------- metaso_search_inner (real integration) ----------

#[tokio::test]
async fn metaso_happy_path_returns_response_body() {
  let resp = ScriptedResponse::raw(200, r#"{"hits":[{"title":"a"},{"title":"b"}]}"#);
  let (base, _cap) = spawn_scripted_server(resp).await;
  let client = reqwest::Client::new();
  // Point at our local mock instead of the real metaso.cn
  let r = metaso_search_inner(
    &client,
    "k",
    "rust async",
    Some("webpage".into()),
    Some(5),
    &base,
  )
  .await
  .unwrap();
  assert!(r.contains(r#""title":"a""#));
  assert!(r.contains(r#""title":"b""#));
}

#[tokio::test]
async fn metaso_sends_authorization_and_content_type_headers() {
  let resp = ScriptedResponse::raw(200, "ok");
  let (base, cap) = spawn_scripted_server(resp).await;
  let client = reqwest::Client::new();
  let _ = metaso_search_inner(&client, "secret", "q", None, None, &base).await;
  let req = cap.lock().await.clone().expect("captured request");
  assert!(
    req.contains("authorization: Bearer secret"),
    "missing auth header: {req}"
  );
  assert!(
    req.contains("content-type: application/json"),
    "missing content-type: {req}"
  );
}

#[tokio::test]
async fn metaso_sends_request_body_with_defaults_when_scope_and_size_omitted() {
  let resp = ScriptedResponse::raw(200, "ok");
  let (base, cap) = spawn_scripted_server(resp).await;
  let client = reqwest::Client::new();
  let _ = metaso_search_inner(&client, "k", "hello", None, None, &base).await;
  let req = cap.lock().await.clone().expect("captured request");
  let body_str = req.split("\r\n\r\n").nth(1).unwrap_or("");
  let parsed: Value = serde_json::from_str(body_str).expect("body parses as JSON");
  assert_eq!(parsed["q"], "hello");
  assert_eq!(parsed["scope"], "webpage");
  assert_eq!(parsed["size"], 5);
}

#[tokio::test]
async fn metaso_sends_request_body_with_chosen_scope_and_size() {
  let resp = ScriptedResponse::raw(200, "ok");
  let (base, cap) = spawn_scripted_server(resp).await;
  let client = reqwest::Client::new();
  let _ = metaso_search_inner(&client, "k", "q", Some("image".into()), Some(12), &base).await;
  let req = cap.lock().await.clone().expect("captured request");
  let body_str = req.split("\r\n\r\n").nth(1).unwrap_or("");
  let parsed: Value = serde_json::from_str(body_str).expect("body parses as JSON");
  assert_eq!(parsed["scope"], "image");
  assert_eq!(parsed["size"], 12);
}

#[tokio::test]
async fn metaso_http_500_propagates_body() {
  let resp = ScriptedResponse::raw(500, "upstream broken");
  let (base, _cap) = spawn_scripted_server(resp).await;
  let client = reqwest::Client::new();
  let err = metaso_search_inner(&client, "k", "q", None, None, &base)
    .await
    .unwrap_err();
  assert!(err.contains("upstream broken"), "got: {err}");
}

#[tokio::test]
async fn metaso_http_500_long_body_preserved_in_error() {
  let body = "Y".repeat(2000);
  let resp = ScriptedResponse::raw(500, body.clone());
  let (base, _cap) = spawn_scripted_server(resp).await;
  let client = reqwest::Client::new();
  let err = metaso_search_inner(&client, "k", "q", None, None, &base)
    .await
    .unwrap_err();
  // Full body is returned (truncation is only in the eprintln log).
  assert_eq!(err.len(), 2000);
}

#[tokio::test]
async fn metaso_network_error_is_reported() {
  let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(2))
    .build()
    .unwrap();
  let err =
    metaso_search_inner(&client, "k", "q", None, None, "http://127.0.0.1:1/").await.unwrap_err();
  assert!(!err.is_empty());
}

#[test]
fn metaso_default_base_url_is_metaso_cn() {
  // The production command should hit the real metaso endpoint. If this
  // changes, the Tauri-side clients may need to be updated too.
  assert_eq!(METASO_BASE_URL, "https://metaso.cn/api/v1/search");
}

// ---------- normalize_metaso_params (pure unit tests) ----------

#[test]
fn normalize_defaults_scope_to_webpage() {
  let (scope, size) = normalize_metaso_params(None, None);
  assert_eq!(scope, "webpage");
  assert_eq!(size, 5);
}

#[test]
fn normalize_preserves_known_scopes() {
  for s in ["image", "video", "podcast"] {
    let (scope, _) = normalize_metaso_params(Some(s.into()), None);
    assert_eq!(scope, s);
  }
}

#[test]
fn normalize_falls_back_to_webpage_for_unknown_scope() {
  for s in ["", "unknown", "WEBPAGE", "garbage", " audio "] {
    let (scope, _) = normalize_metaso_params(Some(s.into()), None);
    assert_eq!(scope, "webpage", "input {s:?} should fall back to webpage");
  }
}

#[test]
fn normalize_clamps_size_to_min_1() {
  let (_, size) = normalize_metaso_params(None, Some(0));
  assert_eq!(size, 1);
}

#[test]
fn normalize_clamps_size_to_max_20() {
  let (_, size) = normalize_metaso_params(None, Some(100));
  assert_eq!(size, 20);
}

#[test]
fn normalize_keeps_size_in_range() {
  let (_, size) = normalize_metaso_params(None, Some(7));
  assert_eq!(size, 7);
}

#[test]
fn normalize_trims_scope_before_matching() {
  let (scope, _) = normalize_metaso_params(Some("  image  ".into()), None);
  assert_eq!(scope, "image");
}

#[test]
fn normalize_whitespace_only_scope_becomes_webpage() {
  let (scope, _) = normalize_metaso_params(Some("   ".into()), None);
  assert_eq!(scope, "webpage");
}

// ---------- open_external_url_validate ----------

#[test]
fn validate_accepts_http() {
  assert_eq!(open_external_url_validate("http://example.com").unwrap(), "http://example.com");
}

#[test]
fn validate_accepts_https() {
  assert_eq!(
    open_external_url_validate("https://example.com/path?q=1").unwrap(),
    "https://example.com/path?q=1"
  );
}

#[test]
fn validate_rejects_file_scheme() {
  let err = open_external_url_validate("file:///etc/passwd").unwrap_err();
  assert!(err.contains("Only http:// and https://"));
}

#[test]
fn validate_rejects_javascript_scheme() {
  let err = open_external_url_validate("javascript:alert(1)").unwrap_err();
  assert!(err.contains("Only http:// and https://"));
}

#[test]
fn validate_rejects_empty_string() {
  let err = open_external_url_validate("").unwrap_err();
  assert!(err.contains("Only http:// and https://"));
}

#[test]
fn validate_rejects_whitespace_only() {
  let err = open_external_url_validate("   ").unwrap_err();
  assert!(err.contains("Only http:// and https://"));
}

#[test]
fn validate_trims_surrounding_whitespace() {
  let r = open_external_url_validate("  https://x.com  ").unwrap();
  assert_eq!(r, "https://x.com");
}

#[test]
fn validate_rejects_ftp() {
  let err = open_external_url_validate("ftp://files.example.com").unwrap_err();
  assert!(err.contains("Only http:// and https://"));
}

// ---------- parse_sse_chunk ----------

#[test]
fn parse_sse_extracts_content_delta() {
  let line = r#"data: {"choices":[{"delta":{"content":"hello"}}]}"#;
  assert_eq!(parse_sse_chunk(line), Some("hello".to_string()));
}

#[test]
fn parse_sse_handles_done_sentinel() {
  assert_eq!(parse_sse_chunk("data: [DONE]"), None);
}

#[test]
fn parse_sse_skips_lines_without_content_field() {
  let line = r#"data: {"choices":[{"delta":{}}]}"#;
  assert_eq!(parse_sse_chunk(line), None);
}

#[test]
fn parse_sse_skips_comment_lines() {
  assert_eq!(parse_sse_chunk(": this is a comment"), None);
}

#[test]
fn parse_sse_skips_event_lines() {
  assert_eq!(parse_sse_chunk("event: message"), None);
}

#[test]
fn parse_sse_skips_empty_lines() {
  assert_eq!(parse_sse_chunk(""), None);
  assert_eq!(parse_sse_chunk("   "), None);
}

#[test]
fn parse_sse_handles_malformed_json() {
  assert_eq!(parse_sse_chunk("data: not-json-at-all"), None);
}

#[test]
fn parse_sse_handles_missing_choices() {
  let line = r#"data: {"foo":"bar"}"#;
  assert_eq!(parse_sse_chunk(line), None);
}

#[test]
fn parse_sse_handles_missing_delta() {
  let line = r#"data: {"choices":[{}]}"#;
  assert_eq!(parse_sse_chunk(line), None);
}

#[test]
fn parse_sse_handles_non_string_content() {
  let line = r#"data: {"choices":[{"delta":{"content":42}}]}"#;
  // `c.as_str()` returns None for numbers → the inner `?` early-returns None
  assert_eq!(parse_sse_chunk(line), None);
}

#[test]
fn parse_sse_handles_crlf_padding() {
  let line = "data:    {\"choices\":[{\"delta\":{\"content\":\"x\"}}]}  ";
  assert_eq!(parse_sse_chunk(line), Some("x".to_string()));
}

import SwiftUI
import WebKit

// The notebook lives on GitHub Pages. The native app is a full-screen shell
// around it, so typed entries stay in sync with the web/desktop automatically.
private let journalURL = URL(string: "https://lelekovtv-ops.github.io/piece-journal/")!
private let journalHost = "lelekovtv-ops.github.io"

// Match the web app's dark shell so there is no flash of white on launch.
private let shellColor = UIColor(red: 0.082, green: 0.071, blue: 0.059, alpha: 1)

struct ContentView: View {
    var body: some View {
        WebView()
            .ignoresSafeArea()
            .background(Color(shellColor))
    }
}

struct WebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = shellColor
        webView.scrollView.backgroundColor = shellColor
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false

        let refresh = UIRefreshControl()
        refresh.tintColor = UIColor(white: 0.85, alpha: 1)
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.reload(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refresh

        context.coordinator.webView = webView
        webView.load(URLRequest(url: journalURL))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        weak var webView: WKWebView?

        @objc func reload(_ sender: UIRefreshControl) { webView?.reload() }

        // Keep the notebook itself in-app; send GitHub (commit flow) and any
        // other external link out to Safari.
        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if let url = navigationAction.request.url,
               let host = url.host,
               host != journalHost,
               navigationAction.navigationType == .linkActivated || navigationAction.targetFrame == nil {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.scrollView.refreshControl?.endRefreshing()
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            webView.scrollView.refreshControl?.endRefreshing()
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            webView.scrollView.refreshControl?.endRefreshing()
        }
    }
}

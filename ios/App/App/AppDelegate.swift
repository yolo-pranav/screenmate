import UIKit
import Capacitor
import WebKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

// Hosts the Capacitor bridge (set as the custom class in Main.storyboard) so app-local
// plugins can be registered. These classes live here because the App group in
// App.xcodeproj is a plain group: a new .swift file would not be compiled without
// also adding it to the project.
class MainViewController: CAPBridgeViewController {
    // WKWebView holds its uiDelegate weakly, so the proxy is kept alive here.
    private var newWindowBlocker: NewWindowBlockingUIDelegate?

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NavigationGuardPlugin())
        // window.open() (e.g. links inside an embedded player) never reaches the
        // navigation policy that NavigationGuardPlugin hooks: WebKit asks the UI
        // delegate to create a window, and Capacitor's handler opens the URL in
        // Safari. Put a proxy in front of Capacitor's delegate that refuses new
        // windows and forwards everything else (alerts, confirms, prompts).
        if let webView = webView {
            let blocker = NewWindowBlockingUIDelegate(forwardingTo: webView.uiDelegate)
            newWindowBlocker = blocker
            webView.uiDelegate = blocker
        }
    }
}

// Refuses every new-window request instead of opening it in Safari, matching the
// Android app; all other WKUIDelegate calls go to the original (Capacitor's) delegate.
final class NewWindowBlockingUIDelegate: NSObject, WKUIDelegate {
    private weak var original: WKUIDelegate?

    init(forwardingTo original: WKUIDelegate?) {
        self.original = original
        super.init()
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        return nil
    }

    override func responds(to aSelector: Selector!) -> Bool {
        return super.responds(to: aSelector) || (original?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if let original = original, original.responds(to: aSelector) {
            return original
        }
        return super.forwardingTarget(for: aSelector)
    }
}

// Keeps the app inside its own pages, like MainActivity does on Android: a top-level
// navigation (or new-window request) to anything other than the app's own origin is
// cancelled instead of being opened in Safari. Navigations inside iframes (trailers,
// embeds) are left to Capacitor's default policy, which allows them.
@objc(NavigationGuardPlugin)
public class NavigationGuardPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NavigationGuardPlugin"
    public let jsName = "NavigationGuard"
    public let pluginMethods: [CAPPluginMethod] = []

    // Returning true cancels the load; returning nil defers to Capacitor's default policy.
    override public func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        let isTopLevel = navigationAction.targetFrame == nil || navigationAction.targetFrame?.isMainFrame == true
        guard isTopLevel else {
            return nil
        }
        guard let url = navigationAction.request.url else {
            return nil
        }
        if isAppOrigin(url) {
            return nil
        }
        return NSNumber(value: true)
    }

    private func isAppOrigin(_ url: URL) -> Bool {
        if url.scheme?.lowercased() == "capacitor" && url.host?.lowercased() == "localhost" {
            return true
        }
        guard let config = bridge?.config else {
            return false
        }
        return sameOrigin(url, config.localURL) || sameOrigin(url, config.serverURL)
    }

    private func sameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
        guard let lhsScheme = lhs.scheme?.lowercased(), let lhsHost = lhs.host?.lowercased() else {
            return false
        }
        return lhsScheme == rhs.scheme?.lowercased() && lhsHost == rhs.host?.lowercased() && lhs.port == rhs.port
    }
}

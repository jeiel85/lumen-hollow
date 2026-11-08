package com.jeiel85.lumenhollow;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.function.Consumer;

/**
 * 2~4장 한 번 결제(#51). Google Play Billing Library로 비소모성 상품 하나를 사고, 앱을 열 때마다 Play에 구매를 다시 묻는다.
 * 서버 검증은 하지 않는다: Play가 돌려준 구매 상태만 본다(환불·취소된 구매는 Play가 더 돌려주지 않아 다음 확인에서 다시 잠긴다).
 * 산 구매는 3일 안에 확인(acknowledge)하지 않으면 Play가 돌려주므로, 살 때와 확인할 때마다 확인되지 않은 구매를 확인한다.
 *
 * status({ product }) → { owned, pending, price }  (price: Play가 정한 그 나라 표시 가격, 상품을 못 찾으면 없음)
 * buy({ product })    → { result: 'owned' | 'pending' | 'canceled' | 'unavailable' | 'error', code?, message? }
 * 이벤트 'purchase' { product, owned, pending }: 대기(pending) 중이던 결제가 나중에 끝나는 등, 구매 창 밖에서 상태가 바뀔 때.
 * 결정과 대안은 DECISIONS.md "2~4장 한 번 결제".
 */
@CapacitorPlugin(name = "Billing")
public class BillingPlugin extends Plugin implements PurchasesUpdatedListener {
    private BillingClient client;
    private PluginCall buying; // 구매 창이 열려 있는 동안의 buy 호출
    private String buyingProduct;
    private final List<Runnable> onReady = new ArrayList<>();
    private final List<Consumer<BillingResult>> onFail = new ArrayList<>();
    private boolean connecting = false;

    @Override
    public void load() {
        client = BillingClient.newBuilder(getContext())
            .setListener(this)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .enableAutoServiceReconnection()
            .build();
    }

    // Play 결제 서비스에 붙은 뒤 할 일을 한다. 붙지 못하면(Play 스토어 없음·로그인 안 됨 등) fail을 부른다.
    private synchronized void whenReady(Runnable then, Consumer<BillingResult> fail) {
        if (client.isReady()) {
            then.run();
            return;
        }
        onReady.add(then);
        onFail.add(fail);
        if (connecting) return;
        connecting = true;
        client.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult result) {
                List<Runnable> ok;
                List<Consumer<BillingResult>> bad;
                synchronized (BillingPlugin.this) {
                    connecting = false;
                    ok = new ArrayList<>(onReady);
                    bad = new ArrayList<>(onFail);
                    onReady.clear();
                    onFail.clear();
                }
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) for (Runnable r : ok) r.run();
                else for (Consumer<BillingResult> f : bad) f.accept(result);
            }

            @Override
            public void onBillingServiceDisconnected() {
                synchronized (BillingPlugin.this) {
                    connecting = false;
                }
            }
        });
    }

    private static void rejectWith(PluginCall call, BillingResult r) {
        call.reject("Play 결제에 연결하지 못했습니다: " + r.getDebugMessage(), String.valueOf(r.getResponseCode()));
    }

    private static Purchase find(List<Purchase> purchases, String product) {
        if (purchases == null) return null;
        for (Purchase p : purchases) if (p.getProducts().contains(product)) return p;
        return null;
    }

    // 산 구매가 아직 확인되지 않았으면 확인한다(3일 안에 하지 않으면 Play가 환불한다).
    private void acknowledge(Purchase p) {
        if (p.getPurchaseState() != Purchase.PurchaseState.PURCHASED || p.isAcknowledged()) return;
        AcknowledgePurchaseParams params = AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.getPurchaseToken()).build();
        client.acknowledgePurchase(params, (r) -> {
            if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                android.util.Log.w("LumenBilling", "구매 확인 실패 " + r.getResponseCode() + " " + r.getDebugMessage());
            }
        });
    }

    private void details(String product, Consumer<ProductDetails> then) {
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
            .setProductList(Collections.singletonList(
                QueryProductDetailsParams.Product.newBuilder().setProductId(product).setProductType(BillingClient.ProductType.INAPP).build()))
            .build();
        client.queryProductDetailsAsync(params, (r, res) -> {
            ProductDetails found = null;
            if (r.getResponseCode() == BillingClient.BillingResponseCode.OK && res != null) {
                for (ProductDetails d : res.getProductDetailsList()) if (product.equals(d.getProductId())) found = d;
            }
            then.accept(found);
        });
    }

    @PluginMethod
    public void status(PluginCall call) {
        String product = call.getString("product");
        if (product == null || product.isEmpty()) {
            call.reject("product가 필요합니다.");
            return;
        }
        whenReady(() -> {
            QueryPurchasesParams params = QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build();
            client.queryPurchasesAsync(params, (r, purchases) -> {
                if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    call.reject("구매 내역을 받지 못했습니다: " + r.getDebugMessage(), String.valueOf(r.getResponseCode()));
                    return;
                }
                Purchase p = find(purchases, product);
                if (p != null) acknowledge(p);
                JSObject ret = new JSObject();
                ret.put("owned", p != null && p.getPurchaseState() == Purchase.PurchaseState.PURCHASED);
                ret.put("pending", p != null && p.getPurchaseState() == Purchase.PurchaseState.PENDING);
                details(product, (d) -> {
                    ProductDetails.OneTimePurchaseOfferDetails offer = d == null ? null : d.getOneTimePurchaseOfferDetails();
                    if (offer != null) ret.put("price", offer.getFormattedPrice());
                    call.resolve(ret);
                });
            });
        }, (r) -> rejectWith(call, r));
    }

    @PluginMethod
    public void buy(PluginCall call) {
        String product = call.getString("product");
        if (product == null || product.isEmpty()) {
            call.reject("product가 필요합니다.");
            return;
        }
        synchronized (this) {
            if (buying != null) {
                call.reject("이미 구매 창이 열려 있습니다.", "busy");
                return;
            }
            buying = call;
            buyingProduct = product;
        }
        call.setKeepAlive(true);
        whenReady(() -> details(product, (d) -> {
            if (d == null) {
                finish(result("unavailable", null));
                return;
            }
            BillingFlowParams params = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(Collections.singletonList(
                    BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(d).build()))
                .build();
            getActivity().runOnUiThread(() -> {
                BillingResult r = client.launchBillingFlow(getActivity(), params);
                if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) finish(fromCode(r, null));
            });
        }), (r) -> finish(result("error", r)));
    }

    private static JSObject result(String kind, BillingResult r) {
        JSObject ret = new JSObject();
        ret.put("result", kind);
        if (r != null) {
            ret.put("code", r.getResponseCode());
            ret.put("message", r.getDebugMessage());
        }
        return ret;
    }

    private JSObject fromCode(BillingResult r, Purchase p) {
        int code = r.getResponseCode();
        if (code == BillingClient.BillingResponseCode.OK && p != null) {
            return result(p.getPurchaseState() == Purchase.PurchaseState.PURCHASED ? "owned" : "pending", null);
        }
        if (code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) return result("owned", null);
        if (code == BillingClient.BillingResponseCode.USER_CANCELED) return result("canceled", null);
        if (code == BillingClient.BillingResponseCode.ITEM_UNAVAILABLE) return result("unavailable", r);
        return result("error", r);
    }

    private void finish(JSObject ret) {
        PluginCall call;
        synchronized (this) {
            call = buying;
            buying = null;
            buyingProduct = null;
        }
        if (call == null) return;
        call.resolve(ret);
        call.setKeepAlive(false);
        getBridge().releaseCall(call);
    }

    @Override
    public void onPurchasesUpdated(BillingResult r, List<Purchase> purchases) {
        if (purchases != null) {
            for (Purchase p : purchases) {
                acknowledge(p);
                // 구매 창 밖의 변화(대기 중이던 결제가 끝남 등)는 이벤트로 알린다.
                for (String product : p.getProducts()) {
                    JSObject ev = new JSObject();
                    ev.put("product", product);
                    ev.put("owned", p.getPurchaseState() == Purchase.PurchaseState.PURCHASED);
                    ev.put("pending", p.getPurchaseState() == Purchase.PurchaseState.PENDING);
                    notifyListeners("purchase", ev);
                }
            }
        }
        String product;
        synchronized (this) {
            product = buyingProduct;
        }
        if (product != null) finish(fromCode(r, find(purchases, product)));
    }
}

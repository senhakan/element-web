# aCloud Web ve Windows istemci özelleştirme rehberi

Bu belge, aCloud için Element Web ve Element Desktop üzerinde yapılan değişiklikleri, yeni bir upstream
Element sürümüne geçerken izlenecek yolu ve doğrulama listesini tek yerde tutar.

## Kaynak ve sürümleme modeli

- Upstream tabanı: `develop`
- aCloud çalışma dalı: `acloud/desktop-dialpad`
- Windows hedefi: yalnız `x64`
- Ortak istemci kodu: `apps/web`
- Windows kabuk ve IPC kodu: `apps/desktop`
- aCloud Desktop yapılandırması: `apps/desktop/acloud/test/config.json`
- aCloud Desktop paket kimliği: `apps/desktop/acloud/test/build.json`
- Windows test iş akışı: `.github/workflows/acloud_desktop_windows_test.yaml`
- Canlı Web yapılandırması kaynak deposunda takip edilmeyen `apps/web/config.json` dosyasından üretilir.
  Bu dosya Desktop yapılandırmasıyla aynı kurumsal değerleri taşımalıdır.

## Rebrand

- Marka metni her yerde `aCloud` olarak kullanılır.
- Görüşme markası `aCloud Görüşme` olarak gösterilir.
- Windows test ürün adı `aCloud Desktop Test` olur.
- Windows uygulama/protokol kimlikleri `tr.acloud.*` alanındadır.
- Giriş ekranındaki logo dış bağlantı içermez.
- Giriş footer’ındaki Element Blog, Mastodon, GitHub ve Matrix bağlantıları gösterilmez.

Yeni sürümde aşağıdaki dosyalar rebrand açısından yeniden kontrol edilmelidir:

- `apps/desktop/acloud/test/build.json`
- `apps/desktop/acloud/test/config.json`
- `apps/web/src/components/views/auth/AuthFooter.tsx`
- `apps/web/src/components/views/auth/DefaultWelcome.tsx`
- `apps/web/src/components/views/auth/AuthHeaderLogo.tsx`
- `apps/web/src/SdkConfig.ts`

## Caller / SIP dialpad

Caller, Element Web uygulamasına eklenen ortak bir katmandır ve aynı Web paketi Desktop içinde de çalışır.

Ana dosyalar:

- `apps/web/res/acloud/softphone-launcher.js`
- `apps/web/res/acloud/softphone-launcher.css`
- `apps/web/src/vector/index.html`
- `apps/web/webpack.config.ts`

Desktop’a özel SIP profil erişimi:

- `apps/desktop/src/ipc.ts`
- `apps/desktop/src/preload.cts`
- `apps/web/src/@types/global.d.ts`

Davranış özeti:

- SIP profili Matrix oturumundan alınır.
- Desktop’ta profil isteği Electron ana süreç proxy’sinden geçer.
- Telefon numaraları aramadan önce boşluk ve biçim karakterlerinden normalize edilir.
- Caller, kapalı Space panelinde ikon; açık panelde Threads ve Settings ile hizalı ikon/metin olarak görünür.
- Gelen ve giden çağrılar kart olarak gösterilir.
- Cevapla/reddet kontrolleri yalnız ilgili çağrı kartında bulunur.
- Beklet/devam et ve kapat kontrolleri çağrı kartındadır.
- Mikrofon ve hoparlör düğmeleri aynı zamanda seviye göstergesi olarak çalışır.
- Log paneli varsayılan olarak gizlidir; dialpad üzerindeki `*` tuşuna çift tıklama ile açılır.

Yükseltme sonrasında özellikle Space panel DOM sınıfları, Electron preload API’si ve Matrix oturum başlatma sırası
değişmiş olabilir. Caller açılışı, SIP profilinin tek kez alınması, register, gelen çağrı ve giden çağrı ayrı ayrı
test edilmelidir.

## Görüntülü ve sesli görüşme

- `element_call.use_exclusively=true` ile yalnız Element Call kullanılır.
- Legacy Call seçimi gösterilmez.
- Oda görüşmelerinde harici misafir bağlantısı kapalıdır.
- Element Call/LiveKit altyapısı SIP Caller’dan bağımsızdır.

Kontrol edilecek yapılandırma:

```json
"element_call": {
    "brand": "aCloud Görüşme",
    "disable": false,
    "use_exclusively": true
}
```

## Kurumsal arayüz kontrolleri

`enterprise_controls` altında aCloud’a eklenen kontroller:

- `hide_labs`
- `hide_credits`
- `hide_integration_manager`
- `hide_sharing`
- `hide_chat_export`
- `hide_external_invites`
- `hide_developer_tools`
- `disable_telemetry`
- `hide_help_faq`
- `hide_auth_footer`
- `password_reset_contact_message`
- `hide_external_help_links`
- `hide_access_token`
- `managed_account_policy_endpoint`

İlgili tip tanımları `packages/shared-types/lib/config.json.d.ts` içindedir.

Kapatılan veya değiştirilen davranışlar:

- Labs sekmesi
- Credits
- Integration manager
- Mesaj/oda/kişi paylaşımı
- Chat export
- Harici davetler ve çağrı misafir bağlantısı
- Geliştirici araçları
- Telemetri ve bug-report yükleme
- Help FAQ ve giriş footer’ı
- Help > Advanced altındaki access token
- Şifreleme, cihaz doğrulama, key storage, bildirim ve oda güvenliği ekranlarındaki Element yardım linkleri
- Hesap deaktivasyonu
- LDAP ile yönetilen hesaplarda yerel parola değiştirme

## Giriş akışı

- Karşılama ekranı yerine doğrudan Sign in açılır:

```json
"embedded_pages": {
    "login_for_welcome": true
}
```

- `UIFeature.registration=false` ile hesap oluşturma kapalıdır.
- Sunucu adresi kullanıcı tarafından değiştirilemez.
- “Şifremi unuttum” gerçek sıfırlama ekranına gitmez; “Sistem yöneticiniz ile iletişime geçin.” mesajını gösterir.
- `include_profile_data_on_invite: true` Synapse tarafında davet edilen kişinin ad/avatar bilgisinin davette
  görünmesini destekler; bu istemci deposunun dışında yönetilir.

## Desktop otomatik güncelleme

aCloud Windows paketi otomatik güncelleme kullanmaz:

```json
"update_base_url": ""
```

Electron ana süreç yalnız `update_base_url` dolu olduğunda updater’ı başlatır. Yeni upstream sürümünde
`apps/desktop/src/electron-main.ts` içindeki bu koşul yeniden kontrol edilmelidir. Dağıtım kurumun yazılım
dağıtım sistemiyle yapılmalıdır.

## Yeni upstream sürümüne geçiş

1. Mevcut aCloud dalını ve çalışan paket commit’ini etiketleyin.
2. Synapse/Web canlı dizininin ve veritabanının snapshot/yedeğini alın.
3. Upstream `develop` dalını güncelleyin.
4. Yeni bir yükseltme dalı açın; doğrudan çalışan aCloud dalında rebase yapmayın.
5. Upstream değişikliklerini merge edin ve çakışmaları bu belgedeki dosya listesine göre çözün.
6. `apps/desktop/acloud/test/config.json` ile yerel Web config’i karşılaştırın.
7. Biçim, JSON, birim testleri, typecheck ve üretim build çalıştırın.
8. Web’i önce test adresinde yayınlayın.
9. Windows x64 artifact’i üretin ve temiz bir Windows profilinde test edin.
10. SIP, DM, oda, dosya, E2EE ve Element Call kabul testleri tamamlanmadan canlıya geçmeyin.

Önerilen karşılaştırma komutları:

```bash
git diff <son-calısan-etiket>..HEAD -- apps/web apps/desktop packages/shared-types
git log --oneline <upstream-eski>..<upstream-yeni>
```

## Kabul testi

- Doğrudan Sign in açılıyor; kayıt ve dış footer linkleri yok.
- LDAP kullanıcı girişi ve otomatik oturum geri yükleme çalışıyor.
- Caller yalnız yetkili SIP grubunda açılıyor.
- SIP profili tek oturumla alınıyor ve register oluyor.
- Gelen/giden çağrı, cevapla, reddet, beklet, devam et ve kapat çalışıyor.
- Mikrofon/hoparlör mute ve seviye göstergeleri çalışıyor.
- Element Call bire bir ve üç veya daha fazla katılımcıyla çalışıyor.
- Legacy Call seçimi ve çağrı misafir linki görünmüyor.
- Dosya yükleme, indirme ve şifre çözme çalışıyor.
- Share, Export Chat, integrations, Labs, Credits ve access token görünmüyor.
- Şifreleme ve güvenlik ekranlarında `element.io` yardım bağlantısı görünmüyor.
- Desktop logunda otomatik güncellemenin kapalı olduğu doğrulanıyor.

## Yalnız aCloud Web ve onaylı Windows istemci modeli

Matrix Client-Server API genel bir protokoldür. `User-Agent`, cihaz adı veya özel HTTP başlığı kontrolü tek
başına güvenlik sağlamaz; başka bir istemci bunları taklit edebilir. Güvenilir kısıtlama için erişim kimliği
istemci kurulumuna veya yönetilen cihaza kriptografik olarak bağlanmalıdır.

Önerilen katmanlar:

1. Kurum cihazlarında WDAC/AppLocker ile yalnız kurum tarafından imzalanmış aCloud Desktop çalıştırın.
2. Synapse girişini kurumsal OIDC/SSO’ya taşıyın ve doğrudan parola login akışlarını kapatın.
3. Web’i yalnız kurum ağı/VPN veya cihaz sertifikası bulunan tarayıcılara açın.
4. Windows istemci için ayrı bir Matrix API hostname’i kullanın ve Nginx üzerinde mTLS istemci sertifikası
   zorunlu kılın.
5. Kullanıcıya değil yönetilen cihaza verilen sertifikaları MDM üzerinden üretin, yenileyin ve iptal edin.
6. Synapse’i doğrudan internete açmayın; bütün Client-Server trafiğini kontrol edilen reverse proxy’den geçirin.
7. OIDC oturum ve Matrix login denetimlerini SIEM’e gönderin.

`Origin`, `Referer`, `User-Agent` veya uygulamanın gönderdiği sabit bir secret yalnız ek sinyal olarak
kullanılmalıdır. Bunlar onaylı istemciyi kriptografik olarak kanıtlamaz.

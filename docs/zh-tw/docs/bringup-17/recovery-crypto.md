# 新裝置 Recovery data 解密適配流程（Android 17）

本文按時間順序說明：拿到一台新裝置後，如何擷取資訊、撰寫裝置適配、編譯打包、
刷入並逐級驗證 Recovery 對 `/data` 的解密。

範例路徑統一使用 `device/acme/mydevice`、`vendor/acme/mydevice`，模組前綴
`mydevice_rec_`，裝置開關 `MYDEVICE_RECOVERY_CRYPTO`。全部替換為實際值。

## 0. 先判斷能不能適配 {#0-先判断能不能适配}

必須滿足以下全部條件才能繼續，否則後端不支援或需要另寫後端：


| 條件                             | 判斷方法（在正常 Android 中執行）                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Android 17（SDK 37）             | `adb shell getprop ro.build.version.sdk` 為 `37`                                                           |
| FBE + metadata 加密              | `adb shell getprop ro.crypto.state` 為 `encrypted`；`adb shell getprop ro.crypto.metadata.enabled` 為 `true` |
| 有真實 KeyMint 或 Keymaster TEE 實作 | 見[第 1.3 節](#13-sharedsecret-参与者)服務擷取                                                                      |
| 未使用 storage-binding seed       | 後端只接受 `storage_binding=none`；平台或廠商啟用了綁定種子的裝置目前無法適配                                                        |
| 已擷取當前 ROM 對應版本的 vendor 專有檔案    | 安全服務與程式庫必須與手機上執行的 TEE 韌體相符                                                                                  |


## 1. 在正常 Android 中擷取裝置事實 {#1-在正常-android-中采集设备事实}

### 1.1 身分與安全性修補程式 {#11-身份与安全补丁}

```bash
adb shell getprop ro.product.device
adb shell getprop ro.build.version.security_patch
adb shell getprop ro.vendor.build.security_patch
adb shell getprop ro.product.first_api_level
```

Recovery 映像檔必須保持與正常系統相符的修補程式等級。修補程式等級不一致時 KeyMint
可能要求升級金鑰，後端會傳回 `KEY_UPGRADE_REQUIRED` 並停止。

### 1.2 fstab 與掛載 {#12-fstab-与挂载}

```bash
adb shell "grep -E ' /data | /metadata ' /vendor/etc/fstab.*"
adb shell getprop ro.crypto.dm_default_key.options_format.version # 必须为空或者为2
```

第一條需要包含 `/metadata`、`/data` 兩行，撰寫 `recovery.crypto.fstab`
（[第 3.2 節](#32-编写-recoverycryptofstab)）的時候需要使用；

### 1.3 SharedSecret 參與者 {#13-sharedsecret-参与者}

keystore2 會讓**所有** SharedSecret 參與者一起協商 HMAC 金鑰，Recovery 必須
提供完全相同的參與者集合，否則 KeyMint 認證權杖驗證失敗。參與者包括：

- `service list` 中的每個 `ISharedSecret/<執行個體>`；
- `lshal` 中每個 HIDL `keymaster@4.x::IKeymasterDevice/<執行個體>`。

diting 同時有 AIDL `ISharedSecret/default` 與 HIDL Keymaster 4.1/default，
因此需要把 HIDL 一方透過認證橋暴露為 `ISharedSecret/legacy`。

### 1.4 TEE 相依性、裝置節點與韌體 {#14-tee-依赖设备节点和固件}

```bash
adb shell ls -lZ /dev/qseecom /dev/tee* /dev/trusty* /dev/dma_heap /dev/ion
adb shell getprop vendor.sys.listeners.registered
adb shell "grep -E ' /firmware| /vendor/firmware_mnt| /mnt/vendor/persist' /proc/mounts"
```

不存在的節點會報錯，忽略即可；記錄存在的節點、擁有者與標籤。高通裝置的
`qseecomd` 需要 listener 就緒（`vendor.sys.listeners.registered`），並讀取
modem 韌體分割區與 persist。其他平台（MTK、Trusty）使用自己的 TEE 常駐程式，
依本機 `ps -AZ` 與 init rc 確認。

### 1.5 Gatekeeper 屬性 {#15-gatekeeper-属性}

```bash
adb shell getprop | grep -iE "gatekeeper|weaver|spu"
```

diting 正常系統設定了 `vendor.gatekeeper.disable_spu=true`，Recovery 的
init 也照此設定。屬性必須與正常系統保持一致，不能自行改變認證路徑。

## 2. 準備原始碼樹 {#2-准备源码树}

1. 確認 `bootable/recovery` 來自帶 `crypto/android17` 的 Recovery fork。
本儲存庫透過 `local_manifests/recovery-m3e.xml` 替換上游 Recovery；
新裝置的 manifest 同樣要指向該 fork。
2. 同步通用程式碼：
   ```bash
       repo sync -c bootable/recovery
   ```
3. 預覽、套用並檢查平台相依性 helper。它為 AIDL、analyzer、SQLite 等補
Recovery 變體，並套用明確的 `system/sepolicy` 金鑰讀取修補（只在設定了
`recovery_crypto_android17=true` 的 Recovery 政策中生效）：
   ```bash
       python3 bootable/recovery/tools/crypto/prepare_android17.py /path/to/android
       python3 bootable/recovery/tools/crypto/prepare_android17.py /path/to/android --apply
       python3 bootable/recovery/tools/crypto/prepare_android17.py /path/to/android --check
   ```
   ```
   这些改动属于 `hardware/interfaces`、`system/tools/aidl`、`external/sqlite`、
   `system/sepolicy` 等项目，需提交到相应 fork 或每次同步后重新应用。
   ```

廠商服務若相依於平台尚無 Recovery 變體的模組，還要額外補變體。diting 安裝程式
在 helper 之外補了三項，可作為同類問題的參考：
`android.hardware.security.rkp` 的 AIDL 介面、`libkeymaster_messages`，以及
不相依於 ICU 的私有 `libxml2`（`libdrmfs` 需要）。

## 3. 撰寫裝置檔案 {#3-编写设备文件}

依[上游指南](https://github.com/Night-stars-1/platform_bootable_recovery/blob/codex/recovery-image-flashing/crypto/android17/README.zh-CN.md#1-要创建哪些文件)第 1～9 節建立下列檔案。右欄是 diting 對應的參考檔案與必須替換的內容。


| 新裝置檔案                                                        | diting 參考                                                                                                                                      | 需依本機替換                                                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `recovery-crypto/recovery.crypto.conf`                       | [recovery.crypto.conf](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/recovery.crypto.conf)                                                                            | 見[第 3.1 節](#31-编写-recoverycryptoconf)逐欄位來源                                                         |
| `recovery-crypto/recovery.crypto.fstab`                      | [recovery.crypto.fstab](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/recovery.crypto.fstab)                                                                          | [第 1.2 節](#12-fstab-与挂载)正常系統 fstab 的 `/metadata`、`/data` 兩行，見[第 3.2 節](#32-编写-recoverycryptofstab) |
| `recovery-crypto/manifest.xml`                               | [manifest.xml](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/manifest.xml)                                                                                            | 實際服務版本與執行個體；RKP 保留/刪除的判斷見[第 3.3 節](#33-编写-manifestxml)行內命令                                           |
| `recovery-crypto/init.recovery.mydevice-crypto.rc`           | [init.recovery.diting-crypto.rc](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/init.recovery.diting-crypto.rc)                                                        | service 名稱、程式路徑、使用者群組、socket、`seclabel`、韌體與 persist 掛載、啟動順序                                           |
| `recovery-crypto/Android.bp`                                 | [Android.bp](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/Android.bp)                                                                                                | 四個 `prebuilt_etc` 模組；需要時加入認證橋 `cc_binary`                                                           |
| `recovery-crypto/config.mk`、`crypto.mk`、`BoardConfig.mk`     | [diting.mk](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/diting.mk)、[BoardConfig.mk](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/BoardConfig.mk)                                          | 裝置開關、`PRODUCT_PACKAGES`、namespace、政策目錄                                                             |
| `recovery-crypto/sepolicy/`                                  | [recovery.te](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/common/sepolicy/recovery.te)、[service\_contexts](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/common/sepolicy/service_contexts) | 見[第 5 節](#5-编写-sepolicy)。`recovery.te` 必建；另兩個檔案依[第 5.1 節](#51-建哪些文件)判定                             |
| `recovery-crypto/ueventd.crypto.rc`（需要時）                     | [ueventd.crypto.rc](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/common/ueventd.crypto.rc)                                                                           | [第 1.4 節](#14-tee-依赖设备节点和固件)的 TEE 節點與權限                                                            |
| `vendor/acme/mydevice/proprietary/Android.bp` 中的 Recovery 模組 | [vendor.Android.bp](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/vendor.Android.bp)                                                                                  | 本機安全服務與完整程式庫相依，見[第 4 節](#4-厂商服务的依赖闭包)                                                                |


新裝置的廠商模組與認證橋使用**裝置自己的 Soong 開關**
（`SOONG_CONFIG_mydevice_recovery_crypto_device_enabled`），與共享的
`recovery_crypto.android17` 後端開關分開。diting 現有適配把專有模組掛在共享
開關上，屬於歷史寫法，新裝置不要沿用：否則其他機型啟用後端時會嘗試建置本
裝置的專有模組。

產品檔案與 BoardConfig 各加一行 include，並引用同一個 `config.mk`，保證
「打包了服務」與「編入了政策」永遠一起開關：

```make
# device/acme/mydevice/device.mk
$(call inherit-product, device/acme/mydevice/recovery-crypto/crypto.mk)
```

```make
# device/acme/mydevice/BoardConfig.mk
include device/acme/mydevice/recovery-crypto/BoardConfig.mk
```

### 3.1 撰寫 `recovery.crypto.conf` {#31-编写-recoverycryptoconf}

`recovery.crypto.conf` 告訴後端要使用哪個安全服務。逐欄位來源（右側命令在本機
正常 Android 上執行，執行個體名稱原樣謄寫介面全名+執行個體，去掉行首序號與 `: []`）：

```text
profile_version=1                                                        # 固定
platform_sdk=37                                                          # 固定
fstab=/system/etc/recovery.crypto.fstab                                  # 固定
keymint_service=android.hardware.security.keymint.IKeyMintDevice/default # adb shell "service list" | grep -iE "keymint"
security_level=tee                                                       # 默认 tee；有 StrongBox 才写 strongbox
gatekeeper_transport=aidl                                                # adb shell "service list" | grep -E "android.hardware.gatekeeper.IGatekeeper/" 有输出 → aidl + 该实例；无输出 → 走第 3.5 节的 HIDL 决策（passthrough 直连或认证桥；桥也注册 AIDL 名称）
gatekeeper_instance=default                                              # 同上；service list 里的 IGateKeeperService 是 framework 服务，不是 HAL，不能填
weaver_transport=none                                                    # adb shell "service list" | grep -iE "weaver" 无输出 → none；有则 transport=aidl/hidl + 实例名
weaver_instance=                                                         # 同上，无 Weaver 留空
secureclock_service=android.hardware.security.secureclock.ISecureClock/default  # adb shell "service list" | grep -iE "secureclock"
sharedsecret_services=android.hardware.security.sharedsecret.ISharedSecret/default,android.hardware.security.sharedsecret.ISharedSecret/legacy
                                                                         # adb shell "service list" | grep -iE "sharedsecret"；有 HIDL Keymaster 参与者 → 经桥补 legacy；不重复列同一硬件参与者
storage_binding=none                                                     # 固定（确认平台未使用 seed 后照抄）
```

以上是 diting 的最終值。`profile_version`、`platform_sdk`、`storage_binding`
由後端解析器約定，照抄；服務執行個體名稱行的值換裝置必然不同，必須重新擷取。

安裝到 Recovery 的模組宣告：

```bp
prebuilt_etc {
    name: "mydevice_rec_crypto_config",
    recovery: true,
    src: "recovery.crypto.conf",
    filename: "recovery.crypto.conf",
}
```

並將 `mydevice_rec_crypto_config` 加入 `crypto.mk` 的 `PRODUCT_PACKAGES`。

### 3.2 撰寫 `recovery.crypto.fstab` {#32-编写-recoverycryptofstab}

`recovery.crypto.fstab` 是解密後端讀取的分割區與加密設定，必須新建。後端透過
conf 的 `fstab=/system/etc/recovery.crypto.fstab` 讀取它。

檔案只寫 `/metadata` 與 `/data` 兩行，內容取自[第 1.2 節](#12-fstab-与挂载)的第一條命令，按下表處理：


| 欄 / 選項                                                                                                      | 處理                   | 原因                                       |
| ----------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------- |
| 區塊裝置                                                                                                         | 保留，路徑必須在 Recovery 中存在 | 進入 Recovery 後用 `adb shell ls -l <路徑>` 檢查 |
| 掛載點、檔案系統                                                                                                    | 原樣保留                 | 解密後依此類型掛載                                |
| `inlinecrypt` 等掛載選項                                                                                         | 原樣保留，`discard` 可移除   | 硬體包裝金鑰相依於內嵌加密；後端唯讀掛載，不需要 discard          |
| `fileencryption=`、`metadata_encryption=`、`keydirectory=`                                                    | 一個字元都不改              | 必須與磁碟上已有的金鑰與目錄政策一致                        |
| `wait`                                                                                                      | 保留                   | 等待區塊裝置出現                                  |
| `check`、`formattable`、`latemount`、`first_stage_mount`、`quota`、`reservedsize=`、`sysfs_path=`、`checkpoint=` 等 | 刪除                   | 與檢查、格式化、開機掛載順序有關；此檔案只用於解鎖，不能觸發 fsck 或格式化 |


也可以使用以下命令產生可用設定

```
adb shell "grep -E ' /data | /metadata ' /vendor/etc/fstab.*" | awk '
  $2 == "/metadata" { print $1, $2, $3, "noatime,nosuid,nodev", "wait" }
  $2 == "/data" {
    opts = ""
    n = split($4, a, ",")
    for (i = 1; i <= n; i++) if (a[i] != "discard") opts = opts (opts ? "," : "") a[i]
    fs = $5
    sub(/^(latemount,)?wait,(check,)?(formattable,)?/, "", fs)
    sub(/(,quota|,reservedsize=[^,]*|,sysfs_path=[^,]*|,checkpoint=[^,]*)+.*$/, "", fs)
    print $1, $2, $3, opts, (fs ? "wait," : "wait") fs
  }'
```

檔案格式（尖括號部分替換為正常系統 fstab 中的實際值）：

```text
# Independent unlock-only fstab. Never use mount_all/fsck/format on this file.
<metadata 块设备> /metadata <文件系统> <挂载选项> wait
<userdata 块设备> /data <文件系统> <挂载选项> wait,fileencryption=<原值>,keydirectory=<原值>,metadata_encryption=<原值>
```

正常系統 fstab 中沒有的選項不要自行加入。每個項目保持一整行，欄位之間用空格分隔，
不能換行。
加密參數只能來自正常系統 fstab，不能來自原 Recovery fstab 或其他裝置。

在 `recovery-crypto/Android.bp` 中把它安裝到 Recovery：

```bp
prebuilt_etc {
    name: "mydevice_rec_crypto_fstab",
    recovery: true,
    src: "recovery.crypto.fstab",
    filename: "recovery.crypto.fstab",
}
```

並將 `mydevice_rec_crypto_fstab` 加入 `crypto.mk` 的 `PRODUCT_PACKAGES`。

### 3.3 撰寫 `manifest.xml` {#33-编写-manifestxml}

宣告 Recovery 內實際註冊的安全服務介面。介面名稱來自 `service list`（AIDL）或
`lshal`（HIDL），版本號來自 VINTF manifest 宣告；廠商 KeyMint 處理程序同時註冊的
RKP 等介面的判斷見下方行內命令。格式範本（每一項對應一次實際觀測，不能憑空寫）：

```xml
<manifest version="1.0" type="device">
    <hal format="aidl"><name>android.hardware.security.keymint</name><version>1</version>
        <fqname>IKeyMintDevice/<实例名></fqname></hal>      <!-- adb shell service list | grep keymint；version 见 VINTF manifest -->
    <hal format="aidl"><name>android.hardware.security.secureclock</name><version>1</version>
        <fqname>ISecureClock/<实例名></fqname></hal>        <!-- adb shell service list | grep secureclock -->
    <hal format="aidl"><name>android.hardware.security.sharedsecret</name><version>1</version>
        <fqname>ISharedSecret/<实例名></fqname>             <!-- adb shell service list | grep sharedsecret；桥接产出的 legacy 实例与 AIDL 实例都要列 -->
        <fqname>ISharedSecret/legacy</fqname></hal>             <!-- 仅认证桥注册此实例时新增 -->
    <hal format="aidl"><name>android.hardware.security.keymint</name><version>1</version>
        <fqname>IRemotelyProvisionedComponent/default</fqname></hal>  <!-- adb shell "service list" | grep -iE "keymint|remotelyprovisioned"：有 IRemotelyProvisionedComponent/<实例> → 保留，实例照写；无输出 → adb shell "strings /vendor/bin/hw/android.hardware.security.keymint-service-qti | grep -i remotelyprovisioned"（二进制路径来自 ps -AZ 的 keymint 进程）命中 → 保留；无命中 → 删除此条 -->
    <hal format="aidl"><name>android.hardware.gatekeeper</name><version>1</version>
        <fqname>IGatekeeper/<实例名></fqname></hal>         <!-- adb shell "service list" | grep -E "android.hardware.gatekeeper.IGatekeeper/"：有输出 → AIDL 原生，实例照此行写；无输出 → 第 3.5 节决策，桥方案时实例 = 桥注册的实例名（与 auth_service.cpp 的注册字符串一致，diting 为 default） -->
</manifest>
```

安裝模組（加入 `crypto.mk` 的 `PRODUCT_PACKAGES`）：

```bp
prebuilt_etc {
    name: "mydevice_rec_crypto_manifest",
    recovery: true,
    src: "manifest.xml",
    relative_install_path: "vintf/manifest",
    filename: "mydevice-recovery-crypto.xml",
}
```

### 3.4 撰寫 `init.recovery.mydevice-crypto.rc` {#34-编写-initrecoverymydevice-cryptorc}

每個安全服務一段 service 定義。正常系統 service 段的擷取用兩步命令（二進位檔名
是穩定錨點，service 名稱各平台不一定同名，例如 diting 的 qseecomd 實際叫
`vendor.qseecomd`）：

```bash
adb shell "grep -rn '<二进制名，如 qseecomd>' /vendor/etc/init/*.rc | grep -E 'service|start'"   # 步骤 1 → 得到真实 service 名与定义文件
adb shell "grep -A10 'service <步骤 1 得到的真实 service 名>' /vendor/etc/init/<步骤 1 的文件>.rc"    # 步骤 2 → 完整 service 段
```

使用者/群組/socket 等選用行依「有則照抄，無則省略」處理；`seclabel` 網域來自
`ps -AZ`（先依關鍵字初步篩選，再用 `grep -w <程序名稱>` 精確比對，跳過 `[方括號]`
核心執行緒行，取使用者態那一行的網域欄位）；程式路徑 = vendor 模組的 `stem`；
韌體/persist 的唯讀掛載與啟動順序（TEE listener 就緒後再啟動服務）依實測撰寫。
範本與來源註解：

```rc
on post-fs
    # 按第 1.4 节 TEE 依赖挂载（需要时）：
    mount none /firmware /vendor/firmware_mnt ro bind                  
    mkdir /mnt/vendor/persist 0755 root root
    mount ext4 /dev/block/bootdevice/by-name/persist /mnt/vendor/persist ro nosuid nodev noatime noload
    # 在 TEE listener 就绪后再启动服务
    start mydevice-recovery-qseecomd                                   
    start mydevice-recovery-keymint
    start mydevice-recovery-auth                                       


on property:init.svc.fastbootd=running
    stop mydevice-recovery-keymint
    stop mydevice-recovery-auth
    stop mydevice-recovery-qseecomd
    umount /vendor/firmware_mnt
    umount /mnt/vendor/persist

service mydevice-recovery-qseecomd /system/bin/mydevice-recovery-qseecomd
    class hal
    seclabel u:r:tee:s0                                                # 域 = adb shell "ps -AZ" | grep qsee | grep -w qseecomd 输出第一列（跳过[内核线程]行）；diting 为 tee；也可用步骤 2 的 vendor rc seclabel 行核对
    user root                                                          # 照抄正常系统 vendor rc 的 service 定义
    group root drmrpc
    socket notify-topology stream 0660 system drmrpc                   # socket 行 = 步骤 2 输出里原样照抄；vendor rc 无 socket 行则整行省略。注意 service 名可能不是 qseecomd（diting 实际是 vendor.qseecomd），所以先用二进制名搜。diting 实测为 660，六位写法 0660 等价
    disabled
    oneshot

service mydevice-recovery-keymint /system/bin/mydevice-recovery-keymint
    class hal
    seclabel u:r:<KEYMINT 域>:s0                                       # 域来自 adb shell "ps -AZ" | grep keymint（如 vendor_hal_keymint_qti）
    user system                                                        # 照抄正常系统 vendor rc
    group system drmrpc
    disabled
    oneshot

service mydevice-recovery-auth /system/bin/mydevice-recovery-auth       # 仅使用认证桥时存在（见第 2 节/上游指南第 6 节）；原生 AIDL Gatekeeper 时由厂商 AIDL 服务替代
    class hal
    seclabel u:r:<GATEKEEPER 域>:s0                                    # 域来自 adb shell "ps -AZ" | grep gatekeeper（如 vendor_hal_gatekeeper_qti）
    user system
    group system drmrpc
    disabled
    oneshot
```

程式檔名由 vendor 模組的 `stem` 決定；`start` 使用 service 名稱，不寫 Soong
模組名稱。安裝模組（加入 `crypto.mk`）：

```bp
prebuilt_etc {
    name: "mydevice_rec_crypto_init",
    recovery: true,
    src: "init.recovery.mydevice-crypto.rc",
    relative_install_path: "init",
    filename: "init.recovery.mydevice-crypto.rc",
}
```

當橋接新增 `ISharedSecret/legacy` 等未被現有平台政策涵蓋的執行個體時，依[第 5.3 節](#53-编写-service_contexts)
寫入 `sepolicy/service_contexts`。legacy 這一行是
`android.hardware.security.sharedsecret.ISharedSecret/legacy u:object_r:hal_sharedsecret_service:s0`。

### 3.5 Gatekeeper / SharedSecret 的 HIDL 處理決策 {#35-gatekeeper-sharedsecret-的-hidl-处理决策}

僅當第 3.1 節 conf 的 `gatekeeper_transport` 沒有 AIDL `IGatekeeper/<執行個體>`
可寫時才會走到這裡。有兩個事實決定選擇：

1. Recovery 中 libhidl 強制走 passthrough：把 HIDL 服務執行檔放進 ramdisk
或在 manifest 裡加入 HIDL 宣告，都不能提供 Binder HIDL 服務。
2. `sharedsecret_hidl_instances=` 的合法值只有 `4.0/default`、`4.1/default`、
`4.0/strongbox`、`4.1/strongbox`（後端 `config.cpp` 白名單），且要求有可直接
呼叫的 Keymaster passthrough。

按下表選擇：


| 實測結果                                                                                                     | conf 的寫法                                                                                                               | 後續動作                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Recovery 能直接載入本機 HIDL Gatekeeper/Keymaster passthrough（`/vendor/lib64/hw/*.impl*.so` 相依項目可在 Recovery 網域內執行） | `gatekeeper_transport=hidl`、`gatekeeper_instance=<lshal 執行個體>`；SharedSecret 各參與者使用 `sharedsecret_hidl_instances=4.1/<執行個體>` | 在 manifest 用裝置實際實作宣告 HIDL HAL；打包對應的 .impl 程式庫（`relative_install_path: "hw"`）                                                                                                                                                                                                            |
| HIDL 實作相依於 vendor 屬性/工廠函式，不能在 Recovery 網域內直接載入（diting 屬於這類）                                                | `gatekeeper_transport=aidl`、`gatekeeper_instance=default`；`sharedsecret_services` 中經橋補上 `ISharedSecret/legacy`          | 依上游指南第 6 節撰寫/重複使用認證橋：參考 diting [auth\_service.cpp](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/common/auth_service.cpp)（橋在 `vendor_hal_gatekeeper_qti` 網域內載入 HIDL Gatekeeper 1.0 passthrough 與 QTI Keymaster 4.1 工廠，並以 AIDL 暴露）。工廠符號原型必須與本機 `libqtikeymaster4.so` 實際呼叫點一致（diting 工廠傳回裸 `RefBase` 指標，不是 `sp<>`） |


## 4. 廠商服務的相依性閉包 {#4-厂商服务的依赖闭包}

為每個安全服務（KeyMint、TEE 常駐程式、Gatekeeper/Weaver 實作）遞迴收集
`DT_NEEDED`。在 Linux 建置主機的原始碼根目錄執行，`VENDOR_DIR` 換成本機
proprietary 目錄，起點換成本機服務程式：

```bash
VENDOR_DIR=vendor/acme/mydevice/proprietary/vendor
queue=(bin/hw/android.hardware.security.keymint-service-example bin/qseecomd)
declare -A seen
while ((${#queue[@]})); do
    f=${queue[0]}; queue=("${queue[@]:1}")
    [[ -n ${seen[$f]} ]] && continue
    seen[$f]=1
    while read -r lib; do
        if [[ -f $VENDOR_DIR/lib64/$lib ]]; then
            queue+=("lib64/$lib")
        else
            printf '平台库: %s (需要: %s)\n' "$lib" "$f"
        fi
    done < <(readelf -d "$VENDOR_DIR/$f" | sed -n 's/.*Shared library: \[\(.*\)\]/\1/p')
done
printf '%s\n' "${!seen[@]}" | sort
```

- 最後輸出的每個 vendor 檔案都要宣告成 Recovery 專用的預先建構模組
（`recovery: true`，`stem` 保留原檔名，`strip: { none: true }`）。
- 「平台庫」這一行要對應到對應的平台 Soong 模組，並確認該模組有 Recovery 變體；
沒有變體就是[第 2 節](#2-准备源码树)需要補的相依項目。
- `DT_NEEDED` 不包含 `dlopen` 載入的程式庫與設定檔。用
`strings -a <elf> | grep -E '\.so|\.xml|/vendor/|/persist|/firmware'` 找線索，
再在實機日誌中確認。diting 的 `gpfspath_oem_config.xml` 就是這樣補上的；
HAL passthrough 程式庫還需要 `relative_install_path: "hw"`。
- 不要使用 `check_elf_files: false` 掩蓋缺少的相依項目。

## 5. 撰寫 sepolicy {#5-编写-sepolicy}

政策只編進 Recovery。檔案放在 `recovery-crypto/sepolicy/`，在
`recovery-crypto/BoardConfig.mk` 的裝置開關內接入（與 `crypto.mk` 引用同一個
`config.mk`）：

```make
BOARD_VENDOR_SEPOLICY_DIRS += device/acme/mydevice/recovery-crypto/sepolicy
BOARD_SEPOLICY_M4DEFS += recovery_crypto_android17=true
```

第二行只開啟平台修補中的金鑰讀取例外，不包含下面的裝置規則。尖括號中的網域與
類型必須已經存在於本機 vendor 政策或平台政策裡：網域來自[第 3.4 節](#34-编写-initrecoverymydevice-cryptorc)
的 `ps -AZ`（去掉 `u:r:` 與 `:s0`），並與 init RC 的 `seclabel` 相同；類型來自
[第 1.4 節](#14-tee-依赖设备节点和固件) `ls -lZ` 標籤中 `u:object_r:` 後面的名稱。
不要新造網域或類型。diting 的 `vendor_hal_keymint_qti`、`tee`、qseecom 節點類型
不能原樣複製；它的 `BoardConfig.mk` 指向公共目錄
`device/qcom/recovery-crypto-common/sepolicy`，新裝置請使用自己的
`recovery-crypto/sepolicy`。

### 5.1 建哪些檔案 {#51-建哪些文件}


| 檔案                 | 何時建立                                                                                        | 寫什麼                          |
| ------------------ | ------------------------------------------------------------------------------------------- | ---------------------------- |
| `recovery.te`      | 必建                                                                                          | 全部規則放在同一個 `recovery_only` 區塊內 |
| `service_contexts` | [第 3.3 節](#33-编写-manifestxml)寫出的 manifest 裡，某個 `介面全名/執行個體` 在既有 `service_contexts` 中沒有完全相同的一行時 | 每行一個服務標籤                     |
| `file_contexts`    | 僅當某個不在 ramdisk 上的新路徑必須套用既有檔案類型時                                                             | 見[第 5.4 節](#54-编写-file_contexts) |


### 5.2 撰寫 `recovery.te` {#52-编写-recoveryte}

整個檔案只有一個 `recovery_only` 區塊。區塊內註解不能有未配對的單引號，否則 m4 會提前結束
參數，規則外洩到正常系統。先寫解密必讀的資料規則：

```te
recovery_only(`
  # fscrypt v2: GET_ENCRYPTION_KEY_STATUS searches the keyring after ADD.
  allow recovery self:key search;
  r_dir_file(recovery, metadata_file)
  r_dir_file(recovery, system_data_file)
  r_dir_file(recovery, system_data_root_file)
  r_dir_file(recovery, system_userdir_file)
  r_dir_file(recovery, unencrypted_data_file)
  r_dir_file(recovery, media_rw_data_file)
  allow recovery { vold_metadata_file vold_data_file keystore_data_file }:dir { open read getattr search };
  allow recovery { vold_metadata_file vold_data_file keystore_data_file }:file { open read getattr map };
  # OpenDirectory opens every parent of /data/media/0, including /data/media.
  allow recovery media_userdir_file:dir { open read getattr search };
  allow recovery { system_data_file system_data_root_file system_userdir_file media_rw_data_file }:dir ioctl;
  allowxperm recovery { system_data_file system_data_root_file system_userdir_file media_rw_data_file }:dir ioctl { 0x6616 0x6617 0x661a };
')
```

這三個 ioctl 編號只用於讀取加密政策，照抄，不要改成任意 ioctl。金鑰與資料目錄唯讀，
不要加入寫入權限。

然後在同一個區塊裡追加本機服務規則。沒有的服務整段刪除。Recovery 只做 Binder 用戶端，
使用屬性，不使用 `hal_client_domain`（該巨集會使 Recovery 成為 passthrough 成員，並繼承
Gatekeeper 對 vendor 資料的寫入權限）：

```te
  typeattribute recovery halclientdomain;
  typeattribute recovery hal_keymint_client;
  typeattribute recovery hal_gatekeeper_client;
  allow recovery { hal_secureclock_service hal_sharedsecret_service }:service_manager find;
```

`hal_gatekeeper_client` 在沒有 Gatekeeper 時刪除。`secureclock_service` 在 conf
裡留空時，從上一行的花括號中刪掉 `hal_secureclock_service`。

KeyMint 處理程序實際註冊了哪些介面，就只給那些服務 `add`。同時註冊 SecureClock 與
SharedSecret 時：

```te
  allow <KEYMINT 域> { hal_secureclock_service hal_sharedsecret_service }:service_manager { add find };
```

認證橋還註冊 `ISharedSecret/legacy` 時，不要手寫殘缺屬性，用巨集補齊 KeyMint
伺服器端角色，否則 neverallow 失敗：

```te
  hal_server_domain(<GATEKEEPER 域>, hal_keymint)
  binder_use(<GATEKEEPER 域>)
  allow <GATEKEEPER 域> hal_sharedsecret_service:service_manager { add find };
  binder_call(recovery, <GATEKEEPER 域>)
  passthrough_hal_client_domain(<GATEKEEPER 域>, hal_keymaster)
```

上面五行只用於[第 3.5 節](#35-gatekeeper-sharedsecret-的-hidl-处理决策)的認證橋。
原生 AIDL Gatekeeper 不註冊 SharedSecret，不要寫這五行。該網域在既有政策裡還不是
Gatekeeper 伺服器端時，只補 `hal_server_domain(<GATEKEEPER 網域>, hal_gatekeeper)`
與 `binder_use(<GATEKEEPER 網域>)`。passthrough 物件留在廠商 HAL 網域，不要把節點與
vendor 屬性權限加給 `recovery`。
實作確實讀取了某個 vendor 屬性時，再加入 `get_prop(<網域>, <屬性類型>)`。

每個由 init `seclabel` 拉起的網域（KeyMint、Gatekeeper 或認證橋、TEE 常駐程式）各寫：

```te
  r_dir_file(<域>, rootfs)
  allow <域> rootfs:file { execute map };
  domain_trans(init, rootfs, <域>)
```

[第 1.4 節](#14-tee-依赖设备节点和固件)裡該處理程序實際開啟的裝置節點，依 `ls -lZ` 轉譯。
唯讀用 `r_file_perms`，讀寫用 `rw_file_perms`。沒有開啟的節點不要寫。diting 上
`/dev/qseecom` 的類型是 `tee_device`，對應
`allow <GATEKEEPER 網域> tee_device:chr_file rw_file_perms;`，類型名稱以本機標籤為準。

init RC 唯讀 bind 了韌體、且該網域會讀它時，再加入 `r_dir_file(<網域>, firmware_file)`。
Recovery 自己也要讀這個目錄時，同樣加給 `recovery`。

diting 的完整檔案是
[recovery.te](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/common/sepolicy/recovery.te)。其中
`BLKFLSBUF` 與 `proc_meminfo` 是分割區映像檔刷寫用的，解密適配不要抄。

### 5.3 撰寫 `service_contexts` {#53-编写-service_contexts}

[第 5.1 節](#51-建哪些文件)判定需要新增時才建立這個檔案。每行：

```text
<接口全名>/<实例> u:object_r:<服务类型>:s0
```

`<服務類型>` 使用該介面在平台 `service_contexts` 裡已有執行個體的類型，不新造。橋接的
legacy 執行個體：

```text
android.hardware.security.sharedsecret.ISharedSecret/legacy u:object_r:hal_sharedsecret_service:s0
```

這一行只給服務名稱貼標籤。註冊與尋找仍要有第 5.2 節的 `add` 與 `find`。

### 5.4 撰寫 `file_contexts` {#54-编写-file_contexts}

只有下面三條同時成立才建立這個檔案：

1. 路徑不在 Recovery ramdisk 上，建置或 `restorecon` 會依 `file_contexts` 給它貼標籤。
2. 要用的檔案類型在政策裡已經存在，不新造類型。
3. 既有 `file_contexts` 的第一欄正規表達式比對不到這個路徑。

第一欄是正規表達式，不是普通字串。在原始碼根目錄把路徑中的 `.` 寫成 `\\.` 再查；下面只是查法，不是要加入的行：

```bash
grep -RIn --include='file_contexts' -E '/vendor/etc/mydevice-crypto\\.conf' system/sepolicy device vendor
```

已有某行的正規表達式能比對該路徑，就不要再寫。沒有才新增，每行：

```text
<路径正则> u:object_r:<已有文件类型>:s0
```

`<已有檔案類型>` 從本機 `ls -Z <對應檔案>` 裡 `u:object_r:` 後面的名稱抄，或從同一類既有行的右邊抄。不能寫 `recovery_only`，行內也不能有未配對的單引號，否則 `fc_sort` 解析失敗。

## 6. 常見問題 {#6-常见问题}


| 現象                                      | 原因                                                                       | 正確做法                                                     |
| --------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| 刷入後安全服務全部沒啟動                            | 用 `PRODUCT_COPY_FILES` 替換公共樹的 `/init.recovery.qcom.rc`，產品繼承去重保留了舊檔案，匯入遺失 | RC 用獨立 `prebuilt_etc` 安裝到 `/system/etc/init/`，不與既有複製目標競爭 |
| init 無法綁定韌體目錄                           | 啟動時在 ramdisk 中建立或重貼 vendor 目錄標籤被政策拒絕                                       | 建置時用預留位置檔案預先建好掛載點，保持預設標籤，執行時唯讀 bind                        |
| 服務處理程序無法以目標網域執行                            | 試圖把不可變的 ramdisk ELF 重貼標籤為 vendor exec 類型，觸犯 neverallow                      | 保持 `rootfs` 標籤，init 使用明確的 `seclabel` 並加入 `domain_trans`     |
| Soong 在裝置目錄找 `auth_service.cpp`         | 跨目錄 `cc_defaults.srcs` 寫相對檔名                                            | 公共目錄用 `filegroup` 匯出，defaults 用完整模組引用                    |
| 連結回報 `uuid_generate` 未定義                 | `libdm` 需要 `libext2_uuid`                                                | 靜態連結 libdm 時補上 `libext2_uuid`                            |
| 缺少 `aidl-analyzer-main` 的 Recovery 靜態變體 | 平台模組沒有 Recovery 變體                                                       | 執行 helper `--apply`，不要停用 AIDL C++ 後端                      |
| SharedSecret 協商失敗                       | 漏了 HIDL Keymaster 參與者                                                    | 保留正常系統全部參與者，HIDL 一方經橋或 `sharedsecret_hidl_instances` 提供   |
| 金鑰狀態查詢被拒                                | fscrypt v2 查詢需要搜尋 Recovery 金鑰環                                           | `allow recovery self:key search`                         |
| 開啟 `/data/media/0` 被拒                   | 父目錄 `/data/media` 標籤不同，只有 search                                         | 給 `media_userdir_file` 加入唯讀 open                          |

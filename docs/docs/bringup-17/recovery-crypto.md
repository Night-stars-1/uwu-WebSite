# 新设备 Recovery data 解密适配流程（Android 17）

本文按时间顺序说明：拿到一台新设备后，怎样采集信息、编写设备适配、编译打包、
刷入并逐级验证 Recovery 对 `/data` 的解密。

示例路径统一用 `device/acme/mydevice`、`vendor/acme/mydevice`，模块前缀
`mydevice_rec_`，设备开关 `MYDEVICE_RECOVERY_CRYPTO`。全部替换为实际值。

## 0. 先判断能不能适配 {#0-先判断能不能适配}

满足以下全部条件才继续，否则后端不支持或需要另写后端：


| 条件                             | 判断方法（正常 Android 中执行）                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Android 17（SDK 37）             | `adb shell getprop ro.build.version.sdk` 为 `37`                                                           |
| FBE + metadata 加密              | `adb shell getprop ro.crypto.state` 为 `encrypted`；`adb shell getprop ro.crypto.metadata.enabled` 为 `true` |
| 有真实 KeyMint 或 Keymaster TEE 实现 | 见[第 1.3 节](#13-sharedsecret-参与者)服务采集                                                                      |
| 未使用 storage-binding seed       | 后端只接受 `storage_binding=none`；平台或厂商启用了绑定种子的设备当前无法适配                                                        |
| 已提取当前 ROM 对应版本的 vendor 专有文件    | 安全服务和库必须与手机上运行的 TEE 固件匹配                                                                                  |


## 1. 在正常 Android 中采集设备事实 {#1-在正常-android-中采集设备事实}

### 1.1 身份与安全补丁 {#11-身份与安全补丁}

```bash
adb shell getprop ro.product.device
adb shell getprop ro.build.version.security_patch
adb shell getprop ro.vendor.build.security_patch
adb shell getprop ro.product.first_api_level
```

Recovery 镜像必须保持与正常系统匹配的补丁等级。补丁等级不一致时 KeyMint
可能要求升级密钥，后端会返回 `KEY_UPGRADE_REQUIRED` 并停止。

### 1.2 fstab 与挂载 {#12-fstab-与挂载}

```bash
adb shell "grep -E ' /data | /metadata ' /vendor/etc/fstab.*"
adb shell getprop ro.crypto.dm_default_key.options_format.version # 必须为空或者为2
```

第一条需要包含 `/metadata`、`/data` 两行，编写 `recovery.crypto.fstab`
（[第 3.2 节](#32-编写-recoverycryptofstab)）的时候需要使用；

### 1.3 SharedSecret 参与者 {#13-sharedsecret-参与者}

keystore2 会让**所有** SharedSecret 参与者一起协商 HMAC 密钥，Recovery 必须
提供完全相同的参与者集合，否则 KeyMint 认证令牌校验失败。参与者包括：

- `service list` 中的每个 `ISharedSecret/<实例>`；
- `lshal` 中每个 HIDL `keymaster@4.x::IKeymasterDevice/<实例>`。

diting 同时有 AIDL `ISharedSecret/default` 和 HIDL Keymaster 4.1/default，
因此需要把 HIDL 一方通过认证桥暴露为 `ISharedSecret/legacy`。

### 1.4 TEE 依赖、设备节点和固件 {#14-tee-依赖设备节点和固件}

```bash
adb shell ls -lZ /dev/qseecom /dev/tee* /dev/trusty* /dev/dma_heap /dev/ion
adb shell getprop vendor.sys.listeners.registered
adb shell "grep -E ' /firmware| /vendor/firmware_mnt| /mnt/vendor/persist' /proc/mounts"
```

不存在的节点会报错，忽略即可；记录存在的节点、属主和标签。高通设备的
`qseecomd` 需要 listener 就绪（`vendor.sys.listeners.registered`），并读取
modem 固件分区和 persist。其他平台（MTK、Trusty）用自己的 TEE 守护进程，
按本机 `ps -AZ` 和 init rc 确认。

### 1.5 Gatekeeper 属性 {#15-gatekeeper-属性}

```bash
adb shell getprop | grep -iE "gatekeeper|weaver|spu"
```

diting 正常系统设置了 `vendor.gatekeeper.disable_spu=true`，Recovery 的
init 也照此设置。属性必须与正常系统保持一致，不能自行改变认证路径。

## 2. 准备源码树 {#2-准备源码树}

1. 确认 `bootable/recovery` 来自带 `crypto/android17` 的 Recovery fork。
本仓库通过 `local_manifests/recovery-m3e.xml` 替换上游 Recovery；
新设备的 manifest 同样要指向该 fork。
2. 同步通用代码：
   ```bash
       repo sync -c bootable/recovery
   ```
3. 预览、应用并检查平台依赖 helper。它为 AIDL、analyzer、SQLite 等补
Recovery 变体，并应用明确的 `system/sepolicy` 密钥读取补丁（只在设置了
`recovery_crypto_android17=true` 的 Recovery 策略中生效）：
   ```bash
       python3 bootable/recovery/tools/crypto/prepare_android17.py /path/to/android
       python3 bootable/recovery/tools/crypto/prepare_android17.py /path/to/android --apply
       python3 bootable/recovery/tools/crypto/prepare_android17.py /path/to/android --check
   ```
   ```
   这些改动属于 `hardware/interfaces`、`system/tools/aidl`、`external/sqlite`、
   `system/sepolicy` 等项目，需提交到相应 fork 或每次同步后重新应用。
   ```

厂商服务若依赖平台尚无 Recovery 变体的模块，还要额外补变体。diting 安装器
在 helper 之外补了三项，可作为同类问题的参考：
`android.hardware.security.rkp` 的 AIDL 接口、`libkeymaster_messages`，以及
不依赖 ICU 的私有 `libxml2`（`libdrmfs` 需要）。

## 3. 编写设备文件 {#3-编写设备文件}

按[上游指南](https://github.com/Night-stars-1/platform_bootable_recovery/blob/codex/recovery-image-flashing/crypto/android17/README.zh-CN.md#1-要创建哪些文件)第 1～9 节创建下列文件。右列是 diting 对应参考文件和必须替换的内容。


| 新设备文件                                                        | diting 参考                                                                                                                                      | 需按本机替换                                                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `recovery-crypto/recovery.crypto.conf`                       | [recovery.crypto.conf](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/recovery.crypto.conf)                                                                            | 见[第 3.1 节](#31-编写-recoverycryptoconf)逐字段来源                                                         |
| `recovery-crypto/recovery.crypto.fstab`                      | [recovery.crypto.fstab](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/recovery.crypto.fstab)                                                                          | [第 1.2 节](#12-fstab-与挂载)正常系统 fstab 的 `/metadata`、`/data` 两行，见[第 3.2 节](#32-编写-recoverycryptofstab) |
| `recovery-crypto/manifest.xml`                               | [manifest.xml](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/manifest.xml)                                                                                            | 实际服务版本与实例；RKP 保留/删除的判定见[第 3.3 节](#33-编写-manifestxml)行内命令                                           |
| `recovery-crypto/init.recovery.mydevice-crypto.rc`           | [init.recovery.diting-crypto.rc](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/init.recovery.diting-crypto.rc)                                                        | service 名、程序路径、用户组、socket、`seclabel`、固件与 persist 挂载、启动顺序                                           |
| `recovery-crypto/Android.bp`                                 | [Android.bp](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/Android.bp)                                                                                                | 四个 `prebuilt_etc` 模块；需要时加认证桥 `cc_binary`                                                           |
| `recovery-crypto/config.mk`、`crypto.mk`、`BoardConfig.mk`     | [diting.mk](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/diting.mk)、[BoardConfig.mk](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/BoardConfig.mk)                                          | 设备开关、`PRODUCT_PACKAGES`、namespace、策略目录                                                             |
| `recovery-crypto/sepolicy/`                                  | [recovery.te](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/common/sepolicy/recovery.te)、[service\_contexts](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/common/sepolicy/service_contexts) | 见[第 5 节](#5-编写-sepolicy)。`recovery.te` 必建；另两个文件按[第 5.1 节](#51-建哪些文件)判定                             |
| `recovery-crypto/ueventd.crypto.rc`（需要时）                     | [ueventd.crypto.rc](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/common/ueventd.crypto.rc)                                                                           | [第 1.4 节](#14-tee-依赖设备节点和固件)的 TEE 节点和权限                                                            |
| `vendor/acme/mydevice/proprietary/Android.bp` 中的 Recovery 模块 | [vendor.Android.bp](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/vendor.Android.bp)                                                                                  | 本机安全服务和完整库依赖，见[第 4 节](#4-厂商服务的依赖闭包)                                                                |


新设备的厂商模块和认证桥使用**设备自己的 Soong 开关**
（`SOONG_CONFIG_mydevice_recovery_crypto_device_enabled`），与共享的
`recovery_crypto.android17` 后端开关分开。diting 现有适配把专有模块挂在共享
开关上，属于历史写法，新设备不要沿用：否则其他机型启用后端时会尝试构建本
设备的专有模块。

产品文件和 BoardConfig 各加一行 include，并引用同一个 `config.mk`，保证
“打包了服务”和“编入了策略”永远一起开关：

```make
# device/acme/mydevice/device.mk
$(call inherit-product, device/acme/mydevice/recovery-crypto/crypto.mk)
```

```make
# device/acme/mydevice/BoardConfig.mk
include device/acme/mydevice/recovery-crypto/BoardConfig.mk
```

### 3.1 编写 `recovery.crypto.conf` {#31-编写-recoverycryptoconf}

`recovery.crypto.conf` 告诉后端使用哪个安全服务。逐字段来源（右侧命令在本机
正常 Android 上执行，实例名原样誊写接口全名+实例，去掉行首序号和 `: []`）：

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

以上是 diting 的最终值。`profile_version`、`platform_sdk`、`storage_binding`
由后端解析器约定，照抄；服务实例名行的值换设备必然不同，必须重新采集。

安装到 Recovery 的模块声明：

```bp
prebuilt_etc {
    name: "mydevice_rec_crypto_config",
    recovery: true,
    src: "recovery.crypto.conf",
    filename: "recovery.crypto.conf",
}
```

并将 `mydevice_rec_crypto_config` 加入 `crypto.mk` 的 `PRODUCT_PACKAGES`。

### 3.2 编写 `recovery.crypto.fstab` {#32-编写-recoverycryptofstab}

`recovery.crypto.fstab` 是解密后端读取的分区与加密配置，必须新建。后端通过
conf 的 `fstab=/system/etc/recovery.crypto.fstab` 读取它。

文件只写 `/metadata` 和 `/data` 两行，内容取自[第 1.2 节](#12-fstab-与挂载)的第一条命令，按下表处理：


| 列 / 选项                                                                                                      | 处理                   | 原因                                       |
| ----------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------- |
| 块设备                                                                                                         | 保留，路径须在 Recovery 中存在 | 进入 Recovery 后用 `adb shell ls -l <路径>` 检查 |
| 挂载点、文件系统                                                                                                    | 原样保留                 | 解密后按此类型挂载                                |
| `inlinecrypt` 等挂载选项                                                                                         | 原样保留，`discard` 可去掉   | 硬件封装密钥依赖内联加密；后端只读挂载，不需要 discard          |
| `fileencryption=`、`metadata_encryption=`、`keydirectory=`                                                    | 一个字符都不改              | 必须与磁盘上已有密钥和目录策略一致                        |
| `wait`                                                                                                      | 保留                   | 等待块设备出现                                  |
| `check`、`formattable`、`latemount`、`first_stage_mount`、`quota`、`reservedsize=`、`sysfs_path=`、`checkpoint=` 等 | 删除                   | 与检查、格式化、开机挂载顺序有关；此文件只用于解锁，不能触发 fsck 或格式化 |


也可以使用以下命令生成可用配置

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

文件格式（尖括号部分替换为正常系统 fstab 中的实际值）：

```text
# Independent unlock-only fstab. Never use mount_all/fsck/format on this file.
<metadata 块设备> /metadata <文件系统> <挂载选项> wait
<userdata 块设备> /data <文件系统> <挂载选项> wait,fileencryption=<原值>,keydirectory=<原值>,metadata_encryption=<原值>
```

正常系统 fstab 中没有的选项不要自行添加。每个条目保持一整行，列之间用空格分隔，
不能换行。
加密参数只能来自正常系统 fstab，不能来自原 Recovery fstab 或其他设备。

在 `recovery-crypto/Android.bp` 中把它安装到 Recovery：

```bp
prebuilt_etc {
    name: "mydevice_rec_crypto_fstab",
    recovery: true,
    src: "recovery.crypto.fstab",
    filename: "recovery.crypto.fstab",
}
```

并将 `mydevice_rec_crypto_fstab` 加入 `crypto.mk` 的 `PRODUCT_PACKAGES`。

### 3.3 编写 `manifest.xml` {#33-编写-manifestxml}

声明 Recovery 内实际注册的安全服务接口。接口名来自 `service list`（AIDL）或
`lshal`（HIDL），版本号来自 VINTF manifest 声明；厂商 KeyMint 进程同时注册的
RKP 等接口的判定见下方行内命令。格式模板（每一项对应一次实际观测，不能凭空写）：

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

安装模块（加入 `crypto.mk` 的 `PRODUCT_PACKAGES`）：

```bp
prebuilt_etc {
    name: "mydevice_rec_crypto_manifest",
    recovery: true,
    src: "manifest.xml",
    relative_install_path: "vintf/manifest",
    filename: "mydevice-recovery-crypto.xml",
}
```

### 3.4 编写 `init.recovery.mydevice-crypto.rc` {#34-编写-initrecoverymydevice-cryptorc}

每个安全服务一段 service 定义。正常系统 service 段的采集用两步命令（二进制名
是稳定锚点，service 名各平台不一定同名，如 diting 的 qseecomd 实际叫
`vendor.qseecomd`）：

```bash
adb shell "grep -rn '<二进制名，如 qseecomd>' /vendor/etc/init/*.rc | grep -E 'service|start'"   # 步骤 1 → 得到真实 service 名与定义文件
adb shell "grep -A10 'service <步骤 1 得到的真实 service 名>' /vendor/etc/init/<步骤 1 的文件>.rc"    # 步骤 2 → 完整 service 段
```

用户/组/socket 等可选行按“有则照抄，无则省略”处理；`seclabel` 域来自
`ps -AZ`（先按关键字初筛，再用 `grep -w <进程名>` 精确匹配，跳过 `[方括号]`
内核线程行，取用户态那一行的域列）；程序路径 = vendor 模块的 `stem`；
固件/persist 的只读挂载与启动顺序（TEE listener 就绪后再启动服务）按实测写。
模板与来源注释：

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

程序文件名由 vendor 模块的 `stem` 决定；`start` 用 service 名，不写 Soong
模块名。安装模块（加入 `crypto.mk`）：

```bp
prebuilt_etc {
    name: "mydevice_rec_crypto_init",
    recovery: true,
    src: "init.recovery.mydevice-crypto.rc",
    relative_install_path: "init",
    filename: "init.recovery.mydevice-crypto.rc",
}
```

当桥接新增 `ISharedSecret/legacy` 等未被现有平台策略覆盖的实例时，按[第 5.3 节](#53-编写-service_contexts)
写入 `sepolicy/service_contexts`。legacy 这一行是
`android.hardware.security.sharedsecret.ISharedSecret/legacy u:object_r:hal_sharedsecret_service:s0`。

### 3.5 Gatekeeper / SharedSecret 的 HIDL 处理决策 {#35-gatekeeper-sharedsecret-的-hidl-处理决策}

仅当第 3.1 节 conf 的 `gatekeeper_transport` 没有 AIDL `IGatekeeper/<实例>`
可写时才走到这里。两个事实决定选择：

1. Recovery 中 libhidl 强制走 passthrough：把 HIDL 服务可执行文件打进 ramdisk
或在 manifest 里加 HIDL 声明，都不能提供 Binder HIDL 服务。
2. `sharedsecret_hidl_instances=` 的合法值只有 `4.0/default`、`4.1/default`、
`4.0/strongbox`、`4.1/strongbox`（后端 `config.cpp` 白名单），且要求有可直接
调用的 Keymaster passthrough。

按下表选：


| 实测结果                                                                                                     | conf 的写法                                                                                                               | 后续动作                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Recovery 能直接加载本机 HIDL Gatekeeper/Keymaster passthrough（`/vendor/lib64/hw/*.impl*.so` 依赖可在 Recovery 域内运行） | `gatekeeper_transport=hidl`、`gatekeeper_instance=<lshal 实例>`；SharedSecret 分参与者用 `sharedsecret_hidl_instances=4.1/<实例>` | 在 manifest 用设备实际实现声明 HIDL HAL；打包对应 .impl 库（`relative_install_path: "hw"`）                                                                                                                                                                                                            |
| HIDL 实现依赖 vendor 属性/工厂函数，不能在 Recovery 域内直接加载（diting 属于这类）                                                | `gatekeeper_transport=aidl`、`gatekeeper_instance=default`；`sharedsecret_services` 中经桥补 `ISharedSecret/legacy`          | 按上游指南第 6 节写/复用认证桥：参考 diting [auth\_service.cpp](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/common/auth_service.cpp)（桥在 `vendor_hal_gatekeeper_qti` 域内加载 HIDL Gatekeeper 1.0 passthrough 与 QTI Keymaster 4.1 工厂，以 AIDL 暴露）。工厂符号原型必须与本机 `libqtikeymaster4.so` 实际调用点一致（diting 工厂返回裸 `RefBase` 指针，不是 `sp<>`） |


## 4. 厂商服务的依赖闭包 {#4-厂商服务的依赖闭包}

为每个安全服务（KeyMint、TEE 守护进程、Gatekeeper/Weaver 实现）递归收集
`DT_NEEDED`。在 Linux 构建机的源码根目录执行，`VENDOR_DIR` 换成本机
proprietary 目录，起点换成本机服务程序：

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

- 最后输出的每个 vendor 文件都要声明成 Recovery 专用预编译模块
（`recovery: true`，`stem` 保留原文件名，`strip: { none: true }`）。
- “平台库”一行要映射到对应的平台 Soong 模块，并确认该模块有 Recovery 变体；
没有变体就是[第 2 节](#2-准备源码树)需要补的依赖。
- `DT_NEEDED` 不包含 `dlopen` 加载的库和配置文件。用
`strings -a <elf> | grep -E '\.so|\.xml|/vendor/|/persist|/firmware'` 找线索，
再在实机日志中确认。diting 的 `gpfspath_oem_config.xml` 就是这样补上的；
HAL passthrough 库还需要 `relative_install_path: "hw"`。
- 不使用 `check_elf_files: false` 掩盖缺失依赖。

## 5. 编写 sepolicy {#5-编写-sepolicy}

策略只编进 Recovery。文件放在 `recovery-crypto/sepolicy/`，在
`recovery-crypto/BoardConfig.mk` 的设备开关内接入（与 `crypto.mk` 引用同一个
`config.mk`）：

```make
BOARD_VENDOR_SEPOLICY_DIRS += device/acme/mydevice/recovery-crypto/sepolicy
BOARD_SEPOLICY_M4DEFS += recovery_crypto_android17=true
```

第二行只打开平台补丁里的密钥读取例外，不包含下面的设备规则。尖括号中的域和
类型必须已经存在于本机 vendor 策略或平台策略里：域来自[第 3.4 节](#34-编写-initrecoverymydevice-cryptorc)
的 `ps -AZ`（去掉 `u:r:` 和 `:s0`），并与 init RC 的 `seclabel` 相同；类型来自
[第 1.4 节](#14-tee-依赖设备节点和固件) `ls -lZ` 标签中 `u:object_r:` 后面的名字。
不要新造域或类型。diting 的 `vendor_hal_keymint_qti`、`tee`、qseecom 节点类型
不能原样复制；它的 `BoardConfig.mk` 指向公共目录
`device/qcom/recovery-crypto-common/sepolicy`，新设备用自己的
`recovery-crypto/sepolicy`。

### 5.1 建哪些文件 {#51-建哪些文件}


| 文件                 | 何时创建                                                                                        | 写什么                          |
| ------------------ | ------------------------------------------------------------------------------------------- | ---------------------------- |
| `recovery.te`      | 必建                                                                                          | 全部规则放在同一个 `recovery_only` 块内 |
| `service_contexts` | [第 3.3 节](#33-编写-manifestxml)写出的 manifest 里，某个 `接口全名/实例` 在已有 `service_contexts` 中没有完全相同的一行时 | 每行一个服务标签                     |
| `file_contexts`    | 仅当某个不在 ramdisk 上的新路径必须打上已有文件类型时                                                             | 见[第 5.4 节](#54-编写-file_contexts) |


### 5.2 编写 `recovery.te` {#52-编写-recoveryte}

整个文件只有一个 `recovery_only` 块。块内注释不能有未配对的单引号，否则 m4 会提前结束
参数，规则泄漏到正常系统。先写解密必读的数据规则：

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

这三个 ioctl 号只用于读取加密策略，照抄，不要改成任意 ioctl。密钥和数据目录只读，
不要加写权限。

然后在同一个块里追加本机服务规则。没有的服务整段删除。Recovery 只做 Binder 客户端，
用属性，不用 `hal_client_domain`（该宏会使 Recovery 成为 passthrough 成员，并继承
Gatekeeper 对 vendor 数据的写权限）：

```te
  typeattribute recovery halclientdomain;
  typeattribute recovery hal_keymint_client;
  typeattribute recovery hal_gatekeeper_client;
  allow recovery { hal_secureclock_service hal_sharedsecret_service }:service_manager find;
```

`hal_gatekeeper_client` 在没有 Gatekeeper 时删除。`secureclock_service` 在 conf
里留空时，从上一行的花括号中删掉 `hal_secureclock_service`。

KeyMint 进程实际注册了哪些接口，就只给那些服务 `add`。同时注册 SecureClock 和
SharedSecret 时：

```te
  allow <KEYMINT 域> { hal_secureclock_service hal_sharedsecret_service }:service_manager { add find };
```

认证桥还注册 `ISharedSecret/legacy` 时，不要手写残缺属性，用宏补齐 KeyMint
服务端角色，否则 neverallow 失败：

```te
  hal_server_domain(<GATEKEEPER 域>, hal_keymint)
  binder_use(<GATEKEEPER 域>)
  allow <GATEKEEPER 域> hal_sharedsecret_service:service_manager { add find };
  binder_call(recovery, <GATEKEEPER 域>)
  passthrough_hal_client_domain(<GATEKEEPER 域>, hal_keymaster)
```

上面五行只用于[第 3.5 节](#35-gatekeeper-sharedsecret-的-hidl-处理决策)的认证桥。
原生 AIDL Gatekeeper 不注册 SharedSecret，不要写这五行。该域在现有策略里还不是
Gatekeeper 服务端时，只补 `hal_server_domain(<GATEKEEPER 域>, hal_gatekeeper)`
和 `binder_use(<GATEKEEPER 域>)`。passthrough 对象留在厂商 HAL 域，不要把节点和
vendor 属性权限加给 `recovery`。
实现确实读取了某个 vendor 属性时，再加 `get_prop(<域>, <属性类型>)`。

每个由 init `seclabel` 拉起的域（KeyMint、Gatekeeper 或认证桥、TEE 守护进程）各写：

```te
  r_dir_file(<域>, rootfs)
  allow <域> rootfs:file { execute map };
  domain_trans(init, rootfs, <域>)
```

[第 1.4 节](#14-tee-依赖设备节点和固件)里该进程实际打开的设备节点，按 `ls -lZ` 翻译。
只读用 `r_file_perms`，读写用 `rw_file_perms`。没有打开的节点不要写。diting 上
`/dev/qseecom` 的类型是 `tee_device`，对应
`allow <GATEKEEPER 域> tee_device:chr_file rw_file_perms;`，类型名以本机标签为准。

init RC 只读 bind 了固件、且该域会读它时，再加 `r_dir_file(<域>, firmware_file)`。
Recovery 自己要读这个目录时，同样加给 `recovery`。

diting 的完整文件是
[recovery.te](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/common/sepolicy/recovery.te)。其中
`BLKFLSBUF` 和 `proc_meminfo` 是分区镜像刷写用的，解密适配不要抄。

### 5.3 编写 `service_contexts` {#53-编写-service_contexts}

[第 5.1 节](#51-建哪些文件)判定需要新增时才建这个文件。每行：

```text
<接口全名>/<实例> u:object_r:<服务类型>:s0
```

`<服务类型>` 用该接口在平台 `service_contexts` 里已有实例的类型，不新造。桥接的
legacy 实例：

```text
android.hardware.security.sharedsecret.ISharedSecret/legacy u:object_r:hal_sharedsecret_service:s0
```

这一行只给服务名打标签。注册和查找仍要有第 5.2 节的 `add` 与 `find`。

### 5.4 编写 `file_contexts` {#54-编写-file_contexts}

只有下面三条同时成立才建这个文件：

1. 路径不在 Recovery ramdisk 上，构建或 `restorecon` 会按 `file_contexts` 给它打标签。
2. 要用的文件类型在策略里已经存在，不新造类型。
3. 已有 `file_contexts` 的第一列正则匹配不到这个路径。

第一列是正则，不是普通字符串。在源码根目录把路径中的 `.` 写成 `\\.` 再查；下面只是查法，不是要添加的行：

```bash
grep -RIn --include='file_contexts' -E '/vendor/etc/mydevice-crypto\\.conf' system/sepolicy device vendor
```

已有某行的正则能匹配该路径，就不要再写。没有才新增，每行：

```text
<路径正则> u:object_r:<已有文件类型>:s0
```

`<已有文件类型>` 从本机 `ls -Z <对应文件>` 里 `u:object_r:` 后面的名字抄，或从同一类已有行的右边抄。不能写 `recovery_only`，行内也不能有未配对的单引号，否则 `fc_sort` 解析失败。

## 6. 常见问题 {#6-常见问题}


| 现象                                      | 原因                                                                       | 正确做法                                                     |
| --------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| 刷入后安全服务全部没启动                            | 用 `PRODUCT_COPY_FILES` 替换公共树的 `/init.recovery.qcom.rc`，产品继承去重保留了旧文件，导入丢失 | RC 用独立 `prebuilt_etc` 安装到 `/system/etc/init/`，不与已有复制目标竞争 |
| init 无法绑定固件目录                           | 启动时在 ramdisk 中创建或重标 vendor 目录被策略拒绝                                       | 构建时用占位文件预先建好挂载点，保持默认标签，运行时只读 bind                        |
| 服务进程无法以目标域运行                            | 试图把不可变 ramdisk ELF 重标为 vendor exec 类型，触犯 neverallow                      | 保持 `rootfs` 标签，init 用显式 `seclabel` 并加 `domain_trans`     |
| Soong 在设备目录找 `auth_service.cpp`         | 跨目录 `cc_defaults.srcs` 写相对文件名                                            | 公共目录用 `filegroup` 导出，defaults 用完整模块引用                    |
| 链接报 `uuid_generate` 未定义                 | `libdm` 需要 `libext2_uuid`                                                | 静态链接 libdm 时补上 `libext2_uuid`                            |
| 缺少 `aidl-analyzer-main` 的 Recovery 静态变体 | 平台模块没有 Recovery 变体                                                       | 运行 helper `--apply`，不禁用 AIDL C++ 后端                      |
| SharedSecret 协商失败                       | 漏了 HIDL Keymaster 参与者                                                    | 保留正常系统全部参与者，HIDL 方经桥或 `sharedsecret_hidl_instances` 提供   |
| 密钥状态查询被拒                                | fscrypt v2 查询需要搜索 Recovery 密钥环                                           | `allow recovery self:key search`                         |
| 打开 `/data/media/0` 被拒                   | 父目录 `/data/media` 标签不同，只有 search                                         | 给 `media_userdir_file` 加只读 open                          |

# Recovery data decryption for a new device (Android 17)

This page walks through, in order, what to do after you get a new device: how to
collect information, write the device adaptation, build and package it, flash it,
and verify Recovery's decryption of `/data` step by step.

Example paths are uniformly `device/acme/mydevice` and `vendor/acme/mydevice`, the
module prefix is `mydevice_rec_`, and the device switch is
`MYDEVICE_RECOVERY_CRYPTO`. Replace all of them with your actual values.

## 0. Check whether the device can be adapted {#eligibility}

Continue only if every condition below holds. Otherwise the backend does not
support the device, or you need to write another backend:


| Condition | How to check (run on a normal Android system) |
| --- | --- |
| Android 17 (SDK 37) | `adb shell getprop ro.build.version.sdk` is `37` |
| FBE + metadata encryption | `adb shell getprop ro.crypto.state` is `encrypted`; `adb shell getprop ro.crypto.metadata.enabled` is `true` |
| A real KeyMint or Keymaster TEE implementation | See the service collection in [section 1.3](#sharedsecret) |
| No storage-binding seed in use | The backend only accepts `storage_binding=none`; devices where the platform or vendor enabled a binding seed cannot be adapted at present |
| Vendor proprietary files extracted for the current ROM version | Security services and libraries must match the TEE firmware running on the phone |


## 1. Collect device facts on a normal Android system {#collect}

### 1.1 Identity and security patch {#identity}

```bash
adb shell getprop ro.product.device
adb shell getprop ro.build.version.security_patch
adb shell getprop ro.vendor.build.security_patch
adb shell getprop ro.product.first_api_level
```

The Recovery image must keep a patch level matching the normal system. When the
patch level differs, KeyMint may require a key upgrade, and the backend returns
`KEY_UPGRADE_REQUIRED` and stops.

### 1.2 fstab and mounts {#fstab}

```bash
adb shell "grep -E ' /data | /metadata ' /vendor/etc/fstab.*"
adb shell getprop ro.crypto.dm_default_key.options_format.version # 必须为空或者为2
```

The first command needs to contain the `/metadata` and `/data` lines; you need
them when writing `recovery.crypto.fstab`
([section 3.2](#fstab-file));

### 1.3 SharedSecret participants {#sharedsecret}

keystore2 makes **all** SharedSecret participants negotiate the HMAC key
together, so Recovery must provide exactly the same participant set, otherwise
KeyMint attestation verification fails. The participants include:

- every `ISharedSecret/<instance>` in `service list`;
- every HIDL `keymaster@4.x::IKeymasterDevice/<instance>` in `lshal`.

diting has both the AIDL `ISharedSecret/default` and HIDL Keymaster 4.1/default,
so the HIDL side must be exposed as `ISharedSecret/legacy` through the
authentication bridge.

### 1.4 TEE dependencies, device nodes, and firmware {#tee}

```bash
adb shell ls -lZ /dev/qseecom /dev/tee* /dev/trusty* /dev/dma_heap /dev/ion
adb shell getprop vendor.sys.listeners.registered
adb shell "grep -E ' /firmware| /vendor/firmware_mnt| /mnt/vendor/persist' /proc/mounts"
```

Nonexistent nodes report an error; just ignore it, and record the nodes that do
exist together with their owner and label. On Qualcomm devices `qseecomd` needs
the listener to be ready (`vendor.sys.listeners.registered`) and reads the modem
firmware partition and persist. Other platforms (MTK, Trusty) use their own TEE
daemon; confirm it with `ps -AZ` and the init rc on the device.

### 1.5 Gatekeeper properties {#gatekeeper}

```bash
adb shell getprop | grep -iE "gatekeeper|weaver|spu"
```

The diting normal system sets `vendor.gatekeeper.disable_spu=true`, and Recovery's
init sets the same. Properties must stay consistent with the normal system; do
not change the authentication path on your own.

## 2. Prepare the source tree {#tree}

1. Confirm that `bootable/recovery` comes from the Recovery fork carrying
`crypto/android17`. This repository replaces the upstream Recovery through
`local_manifests/recovery-m3e.xml`; the manifest for a new device must point at
that fork as well.
2. Sync the common code:
   ```bash
       repo sync -c bootable/recovery
   ```
3. Preview, apply, and check the platform dependency helper. It adds Recovery
variants for AIDL, the analyzer, SQLite, and so on, and applies an explicit
`system/sepolicy` key-reading patch (it only takes effect in Recovery policy that
sets `recovery_crypto_android17=true`):
   ```bash
       python3 bootable/recovery/tools/crypto/prepare_android17.py /path/to/android
       python3 bootable/recovery/tools/crypto/prepare_android17.py /path/to/android --apply
       python3 bootable/recovery/tools/crypto/prepare_android17.py /path/to/android --check
   ```
   ```
   这些改动属于 `hardware/interfaces`、`system/tools/aidl`、`external/sqlite`、
   `system/sepolicy` 等项目，需提交到相应 fork 或每次同步后重新应用。
   ```

If a vendor service depends on a platform module that has no Recovery variant
yet, you have to add the variant as well. Beyond the helper, the diting installer
adds three items, which you can use as a reference for similar problems: the AIDL
interface of `android.hardware.security.rkp`, `libkeymaster_messages`, and a
private `libxml2` that does not depend on ICU (needed by `libdrmfs`).

## 3. Write the device files {#device-files}

Create the files below following sections 1 to 9 of the
[upstream guide](https://github.com/Night-stars-1/platform_bootable_recovery/blob/codex/recovery-image-flashing/crypto/android17/README.zh-CN.md#1-要创建哪些文件). The right column lists the corresponding diting reference file and what must be replaced.


| New device file | diting reference | Replace for your device |
| --- | --- | --- |
| `recovery-crypto/recovery.crypto.conf` | [recovery.crypto.conf](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/recovery.crypto.conf) | See the per-field sources in [section 3.1](#conf) |
| `recovery-crypto/recovery.crypto.fstab` | [recovery.crypto.fstab](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/recovery.crypto.fstab) | The `/metadata` and `/data` lines of the normal system fstab from [section 1.2](#fstab), see [section 3.2](#fstab-file) |
| `recovery-crypto/manifest.xml` | [manifest.xml](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/manifest.xml) | Actual service versions and instances; for deciding whether to keep or remove RKP, see the inline commands in [section 3.3](#manifest) |
| `recovery-crypto/init.recovery.mydevice-crypto.rc` | [init.recovery.diting-crypto.rc](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/init.recovery.diting-crypto.rc) | service name, program path, user/group, socket, `seclabel`, firmware and persist mounts, start order |
| `recovery-crypto/Android.bp` | [Android.bp](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/Android.bp) | the four `prebuilt_etc` modules; add the authentication bridge `cc_binary` when needed |
| `recovery-crypto/config.mk`, `crypto.mk`, `BoardConfig.mk` | [diting.mk](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/diting.mk), [BoardConfig.mk](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/BoardConfig.mk) | device switch, `PRODUCT_PACKAGES`, namespace, policy directory |
| `recovery-crypto/sepolicy/` | [recovery.te](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/common/sepolicy/recovery.te), [service\_contexts](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/common/sepolicy/service_contexts) | See [section 5](#sepolicy). `recovery.te` is mandatory; decide on the other two files per [section 5.1](#which-files) |
| `recovery-crypto/ueventd.crypto.rc` (when needed) | [ueventd.crypto.rc](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/common/ueventd.crypto.rc) | the TEE nodes and permissions from [section 1.4](#tee) |
| Recovery modules in `vendor/acme/mydevice/proprietary/Android.bp` | [vendor.Android.bp](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/vendor.Android.bp) | the device's own security services and full library dependencies, see [section 4](#closure) |


The vendor modules and the authentication bridge of a new device use **the
device's own Soong switch** (`SOONG_CONFIG_mydevice_recovery_crypto_device_enabled`),
separate from the shared `recovery_crypto.android17` backend switch. The existing
diting adaptation hangs proprietary modules on the shared switch, which is a
legacy style; do not follow it on a new device, otherwise other models that
enable the backend will try to build this device's proprietary modules.

Add one include line to the product file and one to BoardConfig, and reference
the same `config.mk`, so that "the service is packaged" and "the policy is
compiled in" always switch together:

```make
# device/acme/mydevice/device.mk
$(call inherit-product, device/acme/mydevice/recovery-crypto/crypto.mk)
```

```make
# device/acme/mydevice/BoardConfig.mk
include device/acme/mydevice/recovery-crypto/BoardConfig.mk
```

### 3.1 Write `recovery.crypto.conf` {#conf}

`recovery.crypto.conf` tells the backend which security service to use. Per-field
sources (run the commands on the right on the device's normal Android system;
copy the instance name verbatim as the full interface name plus instance, with
the leading index and `: []` removed):

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

These are diting's final values. `profile_version`, `platform_sdk`, and
`storage_binding` are agreed by the backend parser, so copy them as is; the values
on the service instance lines necessarily differ on another device and must be
collected again.

The module declaration that installs it into Recovery:

```bp
prebuilt_etc {
    name: "mydevice_rec_crypto_config",
    recovery: true,
    src: "recovery.crypto.conf",
    filename: "recovery.crypto.conf",
}
```

Also add `mydevice_rec_crypto_config` to `PRODUCT_PACKAGES` in `crypto.mk`.

### 3.2 Write `recovery.crypto.fstab` {#fstab-file}

`recovery.crypto.fstab` holds the partitions and encryption configuration that the
decryption backend reads, and it must be created new. The backend reads it
through the conf's `fstab=/system/etc/recovery.crypto.fstab`.

The file contains only the two lines for `/metadata` and `/data`, taken from the
first command in [section 1.2](#fstab), handled per the table below:


| Column / option | Handling | Reason |
| --- | --- | --- |
| Block device | Keep it; the path must exist in Recovery | After entering Recovery, check with `adb shell ls -l <path>` |
| Mount point, file system | Keep as is | Mount with this type after decryption |
| Mount options such as `inlinecrypt` | Keep as is; `discard` may be dropped | Hardware-wrapped keys rely on inline encryption; the backend mounts read-only and does not need discard |
| `fileencryption=`, `metadata_encryption=`, `keydirectory=` | Do not change a single character | They must match the keys and directory policy already on disk |
| `wait` | Keep | Wait for the block device to appear |
| `check`, `formattable`, `latemount`, `first_stage_mount`, `quota`, `reservedsize=`, `sysfs_path=`, `checkpoint=` and so on | Remove | They relate to checking, formatting, and boot mount order; this file is only for unlocking and must not trigger fsck or formatting |


You can also generate a usable configuration with the following command

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

File format (replace the parts in angle brackets with the actual values from the
normal system fstab):

```text
# Independent unlock-only fstab. Never use mount_all/fsck/format on this file.
<metadata 块设备> /metadata <文件系统> <挂载选项> wait
<userdata 块设备> /data <文件系统> <挂载选项> wait,fileencryption=<原值>,keydirectory=<原值>,metadata_encryption=<原值>
```

Do not add options that the normal system fstab does not have. Keep every entry
on a single line, with columns separated by spaces; it must not wrap.
Encryption parameters may only come from the normal system fstab, never from the
original Recovery fstab or another device.

Install it into Recovery in `recovery-crypto/Android.bp`:

```bp
prebuilt_etc {
    name: "mydevice_rec_crypto_fstab",
    recovery: true,
    src: "recovery.crypto.fstab",
    filename: "recovery.crypto.fstab",
}
```

Also add `mydevice_rec_crypto_fstab` to `PRODUCT_PACKAGES` in `crypto.mk`.

### 3.3 Write `manifest.xml` {#manifest}

Declare the security service interfaces actually registered inside Recovery.
Interface names come from `service list` (AIDL) or `lshal` (HIDL), and version
numbers come from the VINTF manifest declaration; for interfaces such as RKP that
the vendor KeyMint process registers as well, decide per the inline commands
below. Format template (each entry corresponds to one actual observation and must
not be written out of thin air):

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

Install module (add to `PRODUCT_PACKAGES` in `crypto.mk`):

```bp
prebuilt_etc {
    name: "mydevice_rec_crypto_manifest",
    recovery: true,
    src: "manifest.xml",
    relative_install_path: "vintf/manifest",
    filename: "mydevice-recovery-crypto.xml",
}
```

### 3.4 Write `init.recovery.mydevice-crypto.rc` {#init-rc}

One service definition per security service. Collect the normal system's service
stanzas with two commands (the binary name is the stable anchor; service names
are not necessarily the same across platforms, e.g. diting's qseecomd is actually
called `vendor.qseecomd`):

```bash
adb shell "grep -rn '<二进制名，如 qseecomd>' /vendor/etc/init/*.rc | grep -E 'service|start'"   # 步骤 1 → 得到真实 service 名与定义文件
adb shell "grep -A10 'service <步骤 1 得到的真实 service 名>' /vendor/etc/init/<步骤 1 的文件>.rc"    # 步骤 2 → 完整 service 段
```

Optional lines such as user/group/socket follow "copy it if present, omit it if
absent"; the `seclabel` domain comes from `ps -AZ` (first filter by keyword, then
match exactly with `grep -w <process name>`, skip `[bracketed]` kernel thread
lines, and take the domain column of the userspace line); the program path = the
vendor module's `stem`; the read-only firmware/persist mounts and the start order
(start the service after the TEE listener is ready) follow what you actually
measure. Template and source comments:

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

The program file name is decided by the vendor module's `stem`; `start` uses the
service name, not the Soong module name. Install module (add to `crypto.mk`):

```bp
prebuilt_etc {
    name: "mydevice_rec_crypto_init",
    recovery: true,
    src: "init.recovery.mydevice-crypto.rc",
    relative_install_path: "init",
    filename: "init.recovery.mydevice-crypto.rc",
}
```

When the bridge adds instances such as `ISharedSecret/legacy` that existing
platform policy does not cover, write them into `sepolicy/service_contexts` per
[section 5.3](#service-contexts). The legacy line is
`android.hardware.security.sharedsecret.ISharedSecret/legacy u:object_r:hal_sharedsecret_service:s0`.

### 3.5 HIDL handling decision for Gatekeeper / SharedSecret {#hidl}

You only reach this point when the conf's `gatekeeper_transport` in section 3.1
has no AIDL `IGatekeeper/<instance>` to write. Two facts decide the choice:

1. libhidl in Recovery is forced onto passthrough: neither packaging the HIDL
service executable into the ramdisk nor adding a HIDL declaration to the manifest
can provide a Binder HIDL service.
2. The only legal values of `sharedsecret_hidl_instances=` are `4.0/default`,
`4.1/default`, `4.0/strongbox`, and `4.1/strongbox` (the backend's `config.cpp`
allowlist), and they require a Keymaster passthrough that can be called directly.

Choose per the table below:


| Measurement result | How to write the conf | Follow-up action |
| --- | --- | --- |
| Recovery can load the device's HIDL Gatekeeper/Keymaster passthrough directly (the `/vendor/lib64/hw/*.impl*.so` dependencies can run inside the Recovery domain) | `gatekeeper_transport=hidl`, `gatekeeper_instance=<lshal instance>`; for SharedSecret participants use `sharedsecret_hidl_instances=4.1/<instance>` | Declare the HIDL HAL in the manifest using the device's actual implementation; package the matching .impl libraries (`relative_install_path: "hw"`) |
| The HIDL implementation depends on vendor properties/factory functions and cannot be loaded directly inside the Recovery domain (diting is this case) | `gatekeeper_transport=aidl`, `gatekeeper_instance=default`; add `ISharedSecret/legacy` through the bridge in `sharedsecret_services` | Write or reuse the authentication bridge per section 6 of the upstream guide: see diting's [auth\_service.cpp](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/common/auth_service.cpp) (the bridge loads the HIDL Gatekeeper 1.0 passthrough and the QTI Keymaster 4.1 factory inside the `vendor_hal_gatekeeper_qti` domain and exposes them over AIDL). The factory symbol prototype must match the actual call site in the device's `libqtikeymaster4.so` (diting's factory returns a raw `RefBase` pointer, not `sp<>`) |


## 4. Dependency closure of vendor services {#closure}

Collect `DT_NEEDED` recursively for each security service (KeyMint, the TEE
daemon, the Gatekeeper/Weaver implementation). Run this in the source root on a
Linux build machine, replace `VENDOR_DIR` with the device's proprietary
directory, and replace the starting points with the device's service programs:

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

- Every vendor file in the final output must be declared as a Recovery-specific
prebuilt module (`recovery: true`, keep the original file name in `stem`,
`strip: { none: true }`).
- Each "platform library" line must be mapped to the corresponding platform Soong
module, and you must confirm that the module has a Recovery variant; if it has
none, it is a dependency you need to add per [section 2](#tree).
- `DT_NEEDED` does not include libraries loaded with `dlopen` or configuration
files. Look for clues with
`strings -a <elf> | grep -E '\.so|\.xml|/vendor/|/persist|/firmware'`, then
confirm in the device logs. diting's `gpfspath_oem_config.xml` was added this way;
HAL passthrough libraries also need `relative_install_path: "hw"`.
- Do not use `check_elf_files: false` to hide missing dependencies.

## 5. Write sepolicy {#sepolicy}

Policy is compiled into Recovery only. Put the files in
`recovery-crypto/sepolicy/` and wire them in inside the device switch in
`recovery-crypto/BoardConfig.mk` (referencing the same `config.mk` as
`crypto.mk`):

```make
BOARD_VENDOR_SEPOLICY_DIRS += device/acme/mydevice/recovery-crypto/sepolicy
BOARD_SEPOLICY_M4DEFS += recovery_crypto_android17=true
```

The second line only turns on the key-reading exception from the platform patch;
it does not include the device rules below. The domains and types in angle
brackets must already exist in the device's vendor policy or platform policy:
domains come from the `ps -AZ` in [section 3.4](#init-rc) (drop `u:r:` and `:s0`)
and match the init RC's `seclabel`; types come from the name after `u:object_r:`
in the `ls -lZ` labels of [section 1.4](#tee).
Do not invent new domains or types. diting's `vendor_hal_keymint_qti`, `tee`, and
qseecom node types cannot be copied verbatim; its `BoardConfig.mk` points at the
shared directory `device/qcom/recovery-crypto-common/sepolicy`, while a new
device uses its own `recovery-crypto/sepolicy`.

### 5.1 Which files to create {#which-files}


| File | When to create | What to write |
| --- | --- | --- |
| `recovery.te` | Mandatory | All rules go in a single `recovery_only` block |
| `service_contexts` | When some `interface full name/instance` in the manifest written in [section 3.3](#manifest) has no exactly matching line in the existing `service_contexts` | One service label per line |
| `file_contexts` | Only when a new path that is not on the ramdisk must carry an existing file type | See [section 5.4](#file-contexts) |


### 5.2 Write `recovery.te` {#recovery-te}

The whole file contains a single `recovery_only` block. Comments inside the block
must not contain an unpaired single quote, otherwise m4 ends the argument early
and the rules leak into the normal system. Start with the data rules required for
decryption:

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

These three ioctl numbers are only used to read the encryption policy; copy them
as is and do not turn them into arbitrary ioctl. Keys and data directories are
read-only; do not add write permissions.

Then append the device's service rules in the same block. Delete whole stanzas
for services you do not have. Recovery is only a Binder client and uses the
attributes, not `hal_client_domain` (that macro makes Recovery a passthrough
member and inherits Gatekeeper's write access to vendor data):

```te
  typeattribute recovery halclientdomain;
  typeattribute recovery hal_keymint_client;
  typeattribute recovery hal_gatekeeper_client;
  allow recovery { hal_secureclock_service hal_sharedsecret_service }:service_manager find;
```

Delete `hal_gatekeeper_client` when there is no Gatekeeper. When
`secureclock_service` is left empty in the conf, drop `hal_secureclock_service`
from the braces on the previous line.

Give `add` only to the services whose interfaces the KeyMint process actually
registers. When it registers both SecureClock and SharedSecret:

```te
  allow <KEYMINT 域> { hal_secureclock_service hal_sharedsecret_service }:service_manager { add find };
```

When the authentication bridge also registers `ISharedSecret/legacy`, do not
hand-write incomplete attributes; use the macros to complete the KeyMint server
role, otherwise neverallow fails:

```te
  hal_server_domain(<GATEKEEPER 域>, hal_keymint)
  binder_use(<GATEKEEPER 域>)
  allow <GATEKEEPER 域> hal_sharedsecret_service:service_manager { add find };
  binder_call(recovery, <GATEKEEPER 域>)
  passthrough_hal_client_domain(<GATEKEEPER 域>, hal_keymaster)
```

The five lines above are only for the authentication bridge in
[section 3.5](#hidl).
Native AIDL Gatekeeper does not register SharedSecret, so do not write these five
lines. When the domain is not yet a Gatekeeper server in the existing policy, add
only `hal_server_domain(<GATEKEEPER domain>, hal_gatekeeper)` and
`binder_use(<GATEKEEPER domain>)`. Passthrough objects stay in the vendor HAL
domain; do not add node and vendor property permissions to `recovery`.
When the implementation really reads a vendor property, then add
`get_prop(<domain>, <property type>)`.

For every domain started by an init `seclabel` (KeyMint, Gatekeeper or the
authentication bridge, the TEE daemon), write:

```te
  r_dir_file(<域>, rootfs)
  allow <域> rootfs:file { execute map };
  domain_trans(init, rootfs, <域>)
```

Translate the device nodes that process actually opens in [section 1.4](#tee) per
`ls -lZ`. Use `r_file_perms` for read-only and `rw_file_perms` for read-write. Do
not write nodes it does not open. On diting the type of `/dev/qseecom` is
`tee_device`, corresponding to
`allow <GATEKEEPER domain> tee_device:chr_file rw_file_perms;`; the type name
follows the device's own label.

When the init RC bind-mounts firmware read-only and that domain will read it, also
add `r_dir_file(<domain>, firmware_file)`. When Recovery itself needs to read that
directory, add the same for `recovery`.

diting's complete file is
[recovery.te](https://github.com/Night-stars-1/uwuaosp-diting/blob/main/cloud/diting_recovery_crypto/common/sepolicy/recovery.te). In it,
`BLKFLSBUF` and `proc_meminfo` are for flashing partition images; do not copy them
for the decryption adaptation.

### 5.3 Write `service_contexts` {#service-contexts}

Create this file only when [section 5.1](#which-files) says new entries are
needed. Each line:

```text
<接口全名>/<实例> u:object_r:<服务类型>:s0
```

Use for `<service type>` the type that existing instances of that interface
already use in the platform `service_contexts`; do not invent one. The bridged
legacy instance:

```text
android.hardware.security.sharedsecret.ISharedSecret/legacy u:object_r:hal_sharedsecret_service:s0
```

This line only labels the service name. Registration and lookup still need the
`add` and `find` from section 5.2.

### 5.4 Write `file_contexts` {#file-contexts}

Create this file only when all three conditions below hold at the same time:

1. The path is not on the Recovery ramdisk, and the build or `restorecon` will
label it according to `file_contexts`.
2. The file type you want to use already exists in policy; do not invent a type.
3. The first-column regex of the existing `file_contexts` does not match this
path.

The first column is a regex, not a plain string. In the source root, write `.` in
the path as `\\.` before searching; the following is only how to search, not a
line to add:

```bash
grep -RIn --include='file_contexts' -E '/vendor/etc/mydevice-crypto\\.conf' system/sepolicy device vendor
```

If an existing line's regex can match the path, do not write another one. Only add
one when none matches, one per line:

```text
<路径正则> u:object_r:<已有文件类型>:s0
```

Copy `<existing file type>` from the name after `u:object_r:` in the device's
`ls -Z <corresponding file>`, or from the right-hand side of an existing line of
the same kind. Do not write `recovery_only`, and no line may contain an unpaired
single quote, otherwise `fc_sort` fails to parse.

## 6. Troubleshooting {#troubleshooting}


| Symptom | Cause | Correct approach |
| --- | --- | --- |
| No security service starts after flashing | `/init.recovery.qcom.rc` in the shared tree was replaced with `PRODUCT_COPY_FILES`; product inheritance deduplicated and kept the old file, so the import was lost | Install the RC to `/system/etc/init/` with a separate `prebuilt_etc` so it does not compete with an existing copy target |
| init cannot bind the firmware directory | Creating or relabeling the vendor directory in the ramdisk at boot is rejected by policy | Pre-create the mount point with a placeholder file at build time, keep the default label, and bind read-only at runtime |
| The service process cannot run in the target domain | Trying to relabel an immutable ramdisk ELF as a vendor exec type violates neverallow | Keep the `rootfs` label, use an explicit `seclabel` in init, and add `domain_trans` |
| Soong looks for `auth_service.cpp` in the device directory | Cross-directory `cc_defaults.srcs` writes a relative file name | Export it from the shared directory with `filegroup` and reference the full module in defaults |
| Link error: `uuid_generate` undefined | `libdm` needs `libext2_uuid` | Add `libext2_uuid` when statically linking libdm |
| The Recovery static variant of `aidl-analyzer-main` is missing | The platform module has no Recovery variant | Run the helper `--apply`; do not disable the AIDL C++ backend |
| SharedSecret negotiation fails | A HIDL Keymaster participant is missing | Keep every participant from the normal system and provide the HIDL side through the bridge or `sharedsecret_hidl_instances` |
| Key status query is denied | The fscrypt v2 query needs to search the Recovery keyring | `allow recovery self:key search` |
| Opening `/data/media/0` is denied | The parent directory `/data/media` has a different label and only allows search | Add read-only open to `media_userdir_file` |

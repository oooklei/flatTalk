# 桂小养 SSO 对接文档

## 1. 接口说明

业务系统通过 AES-GCM 加密的 `userInfo` 参数，实现与桂小养的单点登录（SSO）对接。

### 1.1 接口地址

| 环境 | 地址 |
|------|------|
| 测试环境 | `http://192.168.1.2:5298/gxy-assistant` |
| 生产环境 | `https://YOUR_DOMAIN/gxy-assistant` |

### 1.2 请求方式

- **GET**: `userInfo` 参数放在 URL query string 中
- **POST**: `userInfo` 参数放在 JSON body 中

---

## 2. 加密方式

### 2.1 加密算法

- **算法**: AES/GCM/NoPadding
- **密钥长度**: 16 字节（AES-128）
- **IV 长度**: 12 字节（加密时随机生成，拼在密文前面）
- **认证标签长度**: 16 字节（128 bit，GCM 自动附加）
- **输出格式**: Base64(IV + ciphertext + tag)

### 2.2 共享密钥

请联系桂小养团队获取共享密钥（16字符字符串）。

默认测试密钥: `tr6mxi9go1k9p63j`

### 2.3 加密示例（Java）

```java
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;

public class H5AESUtils {
    private static final String AES = "AES";
    private static final int GCM_IV_LENGTH = 12;
    private static final int GCM_TAG_LENGTH = 16;
    private static final String AES_CIPHER_ALGORITHM = "AES/GCM/NoPadding";

    public static String encrypt(String content, String aesKey) throws Exception {
        byte[] keyBytes = aesKey.getBytes(StandardCharsets.UTF_8);
        SecretKeySpec secretKey = new SecretKeySpec(keyBytes, AES);

        byte[] iv = new byte[GCM_IV_LENGTH];
        SecureRandom random = new SecureRandom();
        random.nextBytes(iv);

        Cipher cipher = Cipher.getInstance(AES_CIPHER_ALGORITHM);
        GCMParameterSpec parameterSpec = new GCMParameterSpec(GCM_TAG_LENGTH * 8, iv);
        cipher.init(Cipher.ENCRYPT_MODE, secretKey, parameterSpec);

        byte[] encrypted = cipher.doFinal(content.getBytes(StandardCharsets.UTF_8));

        // IV + ciphertext + tag
        byte[] combined = new byte[iv.length + encrypted.length];
        System.arraycopy(iv, 0, combined, 0, iv.length);
        System.arraycopy(encrypted, 0, combined, iv.length, encrypted.length);

        return Base64.getEncoder().encodeToString(combined);
    }
}
```

---

## 3. userInfo 格式

### 3.1 JSON 结构

```json
{
  "userId": "test_elder_001",
  "userName": "张三",
  "roleId": "elder",
  "orgId": "org_001",
  "orgName": "南宁青秀区养老中心",
  "terminal": "H5",
  "timestamp": 1785331895000,
  "nonce": "random_string_123"
}
```

### 3.2 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `userId` | string | ✅ | 用户唯一标识 |
| `userName` | string | ✅ | 用户姓名 |
| `roleId` | string | ✅ | 角色编码（见角色映射表） |
| `orgId` | string | ❌ | 机构ID |
| `orgName` | string | ❌ | 机构名称 |
| `terminal` | string | ❌ | 终端类型（H5/APP/PC） |
| `timestamp` | number | ❌ | 毫秒时间戳（防重放，默认±5分钟有效） |
| `nonce` | string | ❌ | 随机串（防重放） |

### 3.3 角色映射表

| 业务系统 roleId | 桂小养 roleKey | 显示名称 | 角色归类 |
|----------------|---------------|---------|---------|
| `LAO_REN` | `elder` | 老人 | 长者 |
| `JIA_SHU` | `elder_family` | 家属 | 长者 |
| `CUN_YI` | `village_doctor` | 村医 | 医护 |
| `SQJJ-YS` | `community_doctor` | 社区居家-医生 | 医护 |
| `nurse` | `care_worker` | 机构端-护理员 | 护理 |
| `SQJJ-HLRY` | `care_worker` | 社区居家-护理人员 | 护理 |
| `SQJJ-JSY` | `care_worker` | 社区居家-驾驶员 | 护理 |
| `SQJJ-ZLY` | `community_helper` | 社区居家-助老员 | 护理 |
| `director` | `institution_admin` | 机构端-院长 | 机构管理 |
| `manager` | `institution_admin` | 机构端-管理员 | 机构管理 |
| `SQJJ-YZ` | `institution_admin` | 社区居家-院长 | 机构管理 |
| `SQJJ-GLY` | `institution_admin` | 社区居家-管理员 | 机构管理 |
| `FU_WU_SHANG` | `provider_staff` | 服务商 | 服务方 |
| `SQJJ-HQ` | `community_support` | 社区居家-后勤 | 服务方 |
| `SQJJ-ST` | `community_canteen` | 社区居家-食堂 | 服务方 |
| `SQJJ-CF` | `community_kitchen` | 社区居家-厨房 | 服务方 |
| `SQJJ-MW` | `community_guard` | 社区居家-门卫 | 服务方 |
| `SQJJ-WX` | `community_maintenance` | 社区居家-维修 | 服务方 |
| `TING_JI_GAN_BU` | `senior_official` | 厅级干部 | 政府/管理 |
| `CHAO_JI_GUAN_LI_YUAN` | `system_admin` | 超级管理员 | 政府/管理 |
| `PEI_ZHI_GUAN_LI_YUAN` | `admin` | 配置管理员 | 政府/管理 |

> **说明**: 多个业务系统角色可能映射到同一个桂小养 roleKey（如 `director`、`manager`、`SQJJ-YZ`、`SQJJ-GLY` 均映射为 `institution_admin`），这是因为在桂小养中它们的权限和行为一致。

---

## 4. 请求示例

### 4.1 POST 请求

```http
POST /gxy-assistant HTTP/1.1
Content-Type: application/json

{
  "userInfo": "AES-GCM-加密后的Base64字符串"
}
```

### 4.2 GET 请求

```http
GET /gxy-assistant?userInfo=AES-GCM-加密后的Base64字符串 HTTP/1.1
```

---

## 5. 返回格式

### 5.1 成功响应

```json
{
  "ok": true,
  "mode": "external_aes_sso",
  "mobileUrl": "https://192.168.1.2:5444/mobile.html?token=xxx&userToken=xxx&roleKey=elder&...",
  "token": "加密后的token",
  "userToken": "加密后的userToken",
  "expiresIn": 3600
}
```

### 5.2 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `ok` | boolean | 是否成功 |
| `mode` | string | 固定值 `external_aes_sso` |
| `mobileUrl` | string | 完整的移动端访问地址（HTTPS） |
| `token` | string | 加密后的 token |
| `userToken` | string | 加密后的 userToken（与 token 相同） |
| `expiresIn` | number | token 有效期（秒），默认 3600 |

### 5.3 错误响应

```json
{
  "ok": false,
  "error": "错误码",
  "message": "错误描述"
}
```

### 5.4 错误码

| 错误码 | HTTP状态码 | 说明 |
|--------|-----------|------|
| `missing_userInfo` | 400 | 缺少 userInfo 参数 |
| `decrypt_failed` | 400 | 解密失败（密钥错误或数据损坏） |
| `invalid_json` | 400 | 解密后不是合法 JSON |
| `expired_request` | 400 | 请求已过期（时间戳超出有效窗口） |
| `duplicate_nonce` | 400 | 请求已使用（重放攻击） |
| `role_not_mapped` | 400 | 角色编码无法映射到桂小养角色 |
| `internal_error` | 500 | 内部错误 |

---

## 6. 使用方式

业务系统收到成功响应后，可选择以下方式打开桂小养：

### 6.1 iframe 嵌入

```javascript
// 发起 SSO 请求
const response = await fetch('/gxy-assistant', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userInfo: encryptedUserInfo })
});

const result = await response.json();
if (result.ok) {
  // 在 iframe 中打开
  document.getElementById('gxy-iframe').src = result.mobileUrl;
}
```

### 6.2 新窗口打开

```javascript
if (result.ok) {
  window.open(result.mobileUrl, '_blank');
}
```

### 6.3 当前页面跳转

```javascript
if (result.ok) {
  window.location.href = result.mobileUrl;
}
```

---

## 7. 完整示例

### 7.1 Java 示例

```java
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.HashMap;
import java.util.Map;

public class GxySsoClient {

    private static final String AES_KEY = "tr6mxi9go1k9p63j";
    private static final String GXY_ASSISTANT_URL = "http://192.168.1.2:5298/gxy-assistant";

    public static String ssoLogin(String userId, String userName, String roleId, String orgId, String orgName) throws Exception {
        // 1. 构建 userInfo JSON
        Map<String, Object> userInfo = new HashMap<>();
        userInfo.put("userId", userId);
        userInfo.put("userName", userName);
        userInfo.put("roleId", roleId);
        userInfo.put("orgId", orgId);
        userInfo.put("orgName", orgName);
        userInfo.put("terminal", "H5");
        userInfo.put("timestamp", System.currentTimeMillis());
        userInfo.put("nonce", java.util.UUID.randomUUID().toString());

        String json = new ObjectMapper().writeValueAsString(userInfo);

        // 2. AES-GCM 加密
        String encryptedUserInfo = H5AESUtils.encrypt(json, AES_KEY);

        // 3. 发送请求
        Map<String, String> requestBody = new HashMap<>();
        requestBody.put("userInfo", encryptedUserInfo);
        String requestBodyJson = new ObjectMapper().writeValueAsString(requestBody);

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(GXY_ASSISTANT_URL))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(requestBodyJson))
                .build();

        HttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());

        // 4. 解析响应
        Map<String, Object> result = new ObjectMapper().readValue(response.body(), HashMap.class);

        if (Boolean.TRUE.equals(result.get("ok"))) {
            return (String) result.get("mobileUrl");
        } else {
            throw new RuntimeException("SSO 失败: " + result.get("message"));
        }
    }
}
```

---

## 8. 安全建议

1. **密钥管理**: 共享密钥应通过安全渠道传输，不要硬编码在代码中
2. **HTTPS**: 生产环境必须使用 HTTPS 协议
3. **时间戳校验**: 建议启用 timestamp 校验，防止重放攻击
4. **nonce 校验**: 建议启用 nonce 校验，防止重复请求
5. **token 有效期**: token 默认有效期为 1 小时，过期后需重新获取

---

## 9. 联系方式

如有问题，请联系桂小养技术团队。

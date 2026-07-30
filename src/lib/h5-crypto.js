/**
 * h5-crypto — AES-GCM 加解密工具包
 *
 * 严格照搬 H5AESUtils.java (com.jpxx.admin.common.util.H5AESUtils) 的算法实现。
 * 算法规格：
 *   - 算法: AES/GCM/NoPadding
 *   - IV 长度: 12 字节 (加密时随机生成，拼在密文前面)
 *   - 认证标签长度: 16 字节 (128 bit，GCM 自动附加在密文末尾)
 *   - 密钥长度: 16 字节 (AES-128)
 *   - 输出: Base64(IV + ciphertext+tag)
 *
 * 与 Java 版的互操作性：
 *   - 本工具包 encrypt() 的输出可被 Java H5AESUtils.decrypt() 解密
 *   - 本工具包 decrypt() 可解密 Java H5AESUtils.encrypt() 的输出
 *
 * @packageDocumentation
 */

import crypto from 'node:crypto';

// ========== 常量（与 H5AESUtils.java 完全一致） ==========
const AES = 'AES';
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
const KEY_LENGTH = 16;
const AES_CIPHER_ALGORITHM = 'aes-128-gcm';

/**
 * 默认密钥 — 与 H5AESUtils.AES_REAL_PERSON_CERTIFICATION 一致
 * Java 源码: public static final String AES_REAL_PERSON_CERTIFICATION = "tr6mxi9go1k9p63j";
 */
const DEFAULT_AES_KEY = 'tr6mxi9go1k9p63j';

/**
 * 根据 aesKey 字符串生成密钥 Buffer
 * 与 Java secretKey() 等价：检查长度必须为 16，然后 new SecretKeySpec(passwordBytes, "AES")
 *
 * @param {string} aesKey - 16 字符密钥
 * @returns {Buffer} 密钥二进制
 * @throws {Error} 密钥长度不为 16 时抛出
 */
function secretKey(aesKey) {
  if (!aesKey) {
    throw new Error(`aes secretKey异常！aesKey:${aesKey}`);
  }
  const passwordBytes = Buffer.from(aesKey, 'utf8');
  if (passwordBytes.length !== KEY_LENGTH && passwordBytes.length !== KEY_LENGTH << 1) {
    throw new Error('aes secretKey长度为16或32');
  }
  return passwordBytes;
}

/**
 * 加密 — 与 H5AESUtils.encrypt() 等价
 *
 * 流程:
 *   1. SecureRandom 生成 12 字节 IV
 *   2. AES/GCM/NoPadding 加密
 *   3. IV 拼在密文前面
 *   4. Base64 编码
 *
 * @param {string} content - 明文
 * @param {string} aesKey - 密钥（默认使用内置密钥）
 * @returns {string} Base64 密文（IV + ciphertext + authTag）
 */
export function encrypt(content, aesKey = DEFAULT_AES_KEY) {
  const key = secretKey(aesKey);
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv(AES_CIPHER_ALGORITHM, key, iv, {
    authTagLength: GCM_TAG_LENGTH,
  });
  const encrypted = Buffer.concat([
    cipher.update(content, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  // Java GCM 实现中 authTag 已自动拼入 ciphertext，但 Node.js 需要手动拼接
  // 为了与 Java 互操作：最终输出 = IV + encrypted + authTag
  const combined = Buffer.concat([iv, encrypted, authTag]);
  return combined.toString('base64');
}

/**
 * 解密 — 与 H5AESUtils.decrypt() 等价
 *
 * 流程:
 *   1. Base64 解码
 *   2. 前 12 字节为 IV
 *   3. 中间为 ciphertext
 *   4. 最后 16 字节为 authTag
 *   5. AES/GCM/NoPadding 解密
 *
 * @param {string} cipherText - Base64 密文
 * @param {string} aesKey - 密钥（默认使用内置密钥）
 * @returns {string} 明文
 */
export function decrypt(cipherText, aesKey = DEFAULT_AES_KEY) {
  const key = secretKey(aesKey);
  const decoded = Buffer.from(cipherText, 'base64');
  const iv = decoded.subarray(0, GCM_IV_LENGTH);
  const authTag = decoded.subarray(decoded.length - GCM_TAG_LENGTH);
  const ciphertext = decoded.subarray(GCM_IV_LENGTH, decoded.length - GCM_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(AES_CIPHER_ALGORITHM, key, iv, {
    authTagLength: GCM_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/**
 * 生成随机 AES 密钥 — 与 H5AESUtils.randomAesKey() 等价
 *
 * @param {number} length - 密钥长度（默认 16）
 * @returns {string} 随机字符串密钥
 */
export function randomAesKey(length = KEY_LENGTH) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

export {
  secretKey,
  DEFAULT_AES_KEY,
  GCM_IV_LENGTH,
  GCM_TAG_LENGTH,
  KEY_LENGTH,
};

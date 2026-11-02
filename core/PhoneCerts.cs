using System.Formats.Asn1;
using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace HyperCore;

/// Certificates for the phone link's secure address (https://hyperspace.local), so an iPhone can keep
/// HYPERSPACE on its home screen and run it with the laptop off (Safari only allows that for secure sites).
/// A small certificate authority of HYPERSPACE's own signs the laptop's certificate. You install that authority
/// on the phone once. It is fenced in with name constraints: it can only ever vouch for *.local names and
/// private network addresses, never for a real website, and its key never leaves this laptop.
///   HyperCore --make-certs <dir> <dns,dns,...> <ip,ip,...>
///   → <dir>/ca.pfx (kept), hyperspace-ca.cer (for the phone), server.pfx (password "hyperspace", 397 days)
static class PhoneCerts
{
    const string Pw = "hyperspace";

    public static int Run(string[] args)
    {
        int a = Array.IndexOf(args, "--make-certs");
        var dir = args[a + 1];
        var names = args[a + 2].Split(',', StringSplitOptions.RemoveEmptyEntries);
        var ips = args.Length > a + 3 ? args[a + 3].Split(',', StringSplitOptions.RemoveEmptyEntries) : Array.Empty<string>();
        Directory.CreateDirectory(dir);
        // The CA's private key could vouch for any device on your home network to the phone, so it's sealed with
        // Windows' own per-account protection (ca.pfx.dpapi) instead of a password written in this file.
        var caFile = Path.Combine(dir, "ca.pfx");
        var sealedFile = caFile + ".dpapi";
        X509Certificate2 ca;
        if (File.Exists(sealedFile))
            ca = new X509Certificate2(ProtectedData.Unprotect(File.ReadAllBytes(sealedFile), null, DataProtectionScope.CurrentUser), Pw, X509KeyStorageFlags.Exportable | X509KeyStorageFlags.EphemeralKeySet);
        else if (File.Exists(caFile))
        {
            ca = new X509Certificate2(caFile, Pw, X509KeyStorageFlags.Exportable | X509KeyStorageFlags.EphemeralKeySet);
            File.WriteAllBytes(sealedFile, ProtectedData.Protect(ca.Export(X509ContentType.Pfx, Pw), null, DataProtectionScope.CurrentUser));
            File.Delete(caFile);
        }
        else
        {
            using var caKey = RSA.Create(2048);
            var req = new CertificateRequest("CN=HYPERSPACE Local CA, O=HYPERSPACE", caKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            req.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, true, 0, true));
            req.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
            req.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(req.PublicKey, false));
            req.CertificateExtensions.Add(new X509Extension("2.5.29.30", NameConstraints(), true));
            var self = req.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(10));
            var pfx = self.Export(X509ContentType.Pfx, Pw);
            File.WriteAllBytes(sealedFile, ProtectedData.Protect(pfx, null, DataProtectionScope.CurrentUser));
            ca = new X509Certificate2(pfx, Pw, X509KeyStorageFlags.Exportable | X509KeyStorageFlags.EphemeralKeySet);
        }
        File.WriteAllBytes(Path.Combine(dir, "hyperspace-ca.cer"), ca.Export(X509ContentType.Cert));

        // the laptop's own certificate: every name and address the phone may use to reach it
        using var key = RSA.Create(2048);
        var sreq = new CertificateRequest($"CN={names[0]}, O=HYPERSPACE", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var san = new SubjectAlternativeNameBuilder();
        foreach (var n in names) san.AddDnsName(n);
        foreach (var ip in ips) if (IPAddress.TryParse(ip, out var addr)) san.AddIpAddress(addr);
        sreq.CertificateExtensions.Add(san.Build());
        sreq.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        sreq.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
        sreq.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(new OidCollection { new Oid("1.3.6.1.5.5.7.3.1") }, false));
        sreq.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(sreq.PublicKey, false));
        sreq.CertificateExtensions.Add(X509AuthorityKeyIdentifierExtension.CreateFromCertificate(ca, true, false));
        var serial = RandomNumberGenerator.GetBytes(16); serial[0] &= 0x7f;
        // Apple requires 825 days or less for TLS certificates; a year leaves room to renew automatically
        using var leaf = sreq.Create(ca, DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(397), serial);
        using var withKey = leaf.CopyWithPrivateKey(key);
        File.WriteAllBytes(Path.Combine(dir, "server.pfx"), withKey.Export(X509ContentType.Pfx, Pw));
        Console.WriteLine($"OK names={string.Join(",", names)} ips={string.Join(",", ips)} until={leaf.NotAfter:yyyy-MM-dd} ca={ca.Thumbprint}");
        return 0;
    }

    // permitted: *.local, localhost and private networks only
    static byte[] NameConstraints()
    {
        var w = new AsnWriter(AsnEncodingRules.DER);
        w.PushSequence();
        var permitted = new Asn1Tag(TagClass.ContextSpecific, 0, true);
        w.PushSequence(permitted);
        foreach (var dns in new[] { "local", "localhost" })
        {
            w.PushSequence();
            w.WriteCharacterString(UniversalTagNumber.IA5String, dns, new Asn1Tag(TagClass.ContextSpecific, 2));
            w.PopSequence();
        }
        foreach (var (net, mask) in new[] { ("192.168.0.0", "255.255.0.0"), ("10.0.0.0", "255.0.0.0"), ("172.16.0.0", "255.240.0.0"), ("169.254.0.0", "255.255.0.0"), ("127.0.0.0", "255.0.0.0") })
        {
            w.PushSequence();
            w.WriteOctetString(IPAddress.Parse(net).GetAddressBytes().Concat(IPAddress.Parse(mask).GetAddressBytes()).ToArray(), new Asn1Tag(TagClass.ContextSpecific, 7));
            w.PopSequence();
        }
        w.PopSequence(permitted);
        w.PopSequence();
        return w.Encode();
    }
}

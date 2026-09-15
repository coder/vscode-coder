using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using System.Threading;

internal static class AclDiagnosisRunner
{
	private const int ProcessTimeoutMilliseconds = 600000;
	private const int TimeoutExitCode = 124;
	private const uint TokenAdjustPrivileges = 0x0020;
	private const uint TokenQuery = 0x0008;
	private const uint SePrivilegeEnabled = 0x00000002;
	private const uint SePrivilegeRemoved = 0x00000004;
	private const int ErrorNotAllAssigned = 1300;

	public static int Main(string[] args)
	{
		if (args == null || args.Length == 0)
		{
			PrintUsage();
			return 2;
		}

		if (string.Equals(args[0], "run", StringComparison.OrdinalIgnoreCase))
		{
			return RunWorker(args);
		}

		if (string.Equals(args[0], "owner", StringComparison.OrdinalIgnoreCase))
		{
			return PrintOwner(args);
		}

		if (string.Equals(args[0], "snapshot", StringComparison.OrdinalIgnoreCase))
		{
			return PrintSnapshot(args);
		}

		if (string.Equals(args[0], "sid", StringComparison.OrdinalIgnoreCase))
		{
			return PrintSid(args);
		}

		if (string.Equals(args[0], "resolve", StringComparison.OrdinalIgnoreCase))
		{
			return ResolveSid(args);
		}

		if (string.Equals(args[0], "seed", StringComparison.OrdinalIgnoreCase))
		{
			return SeedSecurityDescriptor(args);
		}

		if (string.Equals(args[0], "without", StringComparison.OrdinalIgnoreCase))
		{
			return RunWithoutPrivileges(args);
		}

		if (string.Equals(args[0], "metadata", StringComparison.OrdinalIgnoreCase))
		{
			return PrintMetadata(args);
		}

		if (string.Equals(args[0], "setowner", StringComparison.OrdinalIgnoreCase)) { return SetOwner(args); }
		if (string.Equals(args[0], "hold", StringComparison.OrdinalIgnoreCase)) { return HoldFile(args); }
		if (string.Equals(args[0], "read", StringComparison.OrdinalIgnoreCase)) { return ReadFile(args); }
		if (string.Equals(args[0], "probe", StringComparison.OrdinalIgnoreCase)) { return ProbeFile(args); }
		if (string.Equals(args[0], "saclseed", StringComparison.OrdinalIgnoreCase)) { return SeedSacl(args); }
		if (string.Equals(args[0], "saclsnapshot", StringComparison.OrdinalIgnoreCase)) { return PrintSaclSnapshot(args); }

		PrintUsage();
		return 2;
	}

	private static int RunWorker(string[] args)
	{
		if (args.Length != 7)
		{
			PrintUsage();
			return 2;
		}

		SecureString password = CreateSecureString(args[2]);
		try
		{
			ProcessStartInfo startInfo = new ProcessStartInfo
			{
				FileName = args[3],
				Arguments = QuoteArgument(args[4]) + " worker " + QuoteArgument(args[5]) + " " + QuoteArgument(args[6]),
				UserName = args[1],
				Domain = Environment.MachineName,
				Password = password,
				UseShellExecute = false,
				LoadUserProfile = true,
				WorkingDirectory = args[5],
				RedirectStandardOutput = true,
				RedirectStandardError = true,
				CreateNoWindow = true
			};
			return RunProcess(startInfo, "Worker");
		}
		finally
		{
			password.Dispose();
		}
	}

	private static int PrintOwner(string[] args)
	{
		if (args.Length != 2)
		{
			PrintUsage();
			return 2;
		}

		try
		{
			SecurityIdentifier owner;
			if (File.Exists(args[1]))
			{
				owner = File.GetAccessControl(args[1], AccessControlSections.Owner).GetOwner(typeof(SecurityIdentifier)) as SecurityIdentifier;
			}
			else if (Directory.Exists(args[1]))
			{
				owner = Directory.GetAccessControl(args[1], AccessControlSections.Owner).GetOwner(typeof(SecurityIdentifier)) as SecurityIdentifier;
			}
			else
			{
				Console.Error.WriteLine("Path does not exist: " + args[1]);
				return 1;
			}

			if (owner == null)
			{
				Console.Error.WriteLine("Could not determine path owner.");
				return 1;
			}

			Console.WriteLine(owner.Value);
			return 0;
		}
		catch (Exception exception)
		{
			Console.Error.WriteLine(exception.Message);
			return 1;
		}
	}

	private static int PrintSnapshot(string[] args)
	{
		if (args.Length != 2)
		{
			PrintUsage();
			return 2;
		}

		try
		{
			AccessControlSections sections = AccessControlSections.Owner | AccessControlSections.Group | AccessControlSections.Access;
			if (File.Exists(args[1]))
			{
				Console.WriteLine(File.GetAccessControl(args[1], sections).GetSecurityDescriptorSddlForm(sections));
				return 0;
			}

			if (Directory.Exists(args[1]))
			{
				Console.WriteLine(Directory.GetAccessControl(args[1], sections).GetSecurityDescriptorSddlForm(sections));
				return 0;
			}

			Console.Error.WriteLine("Path does not exist: " + args[1]);
			return 1;
		}
		catch (Exception exception)
		{
			Console.Error.WriteLine(exception.Message);
			return 1;
		}
	}

	private static int PrintSid(string[] args)
	{
		if (args.Length != 2)
		{
			PrintUsage();
			return 2;
		}

		try
		{
			SecurityIdentifier sid = new NTAccount(args[1]).Translate(typeof(SecurityIdentifier)) as SecurityIdentifier;
			if (sid == null)
			{
				Console.Error.WriteLine("Could not resolve account to a SID: " + args[1]);
				return 1;
			}

			Console.WriteLine(sid.Value);
			return 0;
		}
		catch (IdentityNotMappedException)
		{
			Console.Error.WriteLine("Account is not mapped to a SID: " + args[1]);
			return 1;
		}
		catch (Exception exception)
		{
			Console.Error.WriteLine(exception.Message);
			return 1;
		}
	}

	private static int ResolveSid(string[] args)
	{
		if (args.Length != 2)
		{
			PrintUsage();
			return 2;
		}

		try
		{
			NTAccount account = new SecurityIdentifier(args[1]).Translate(typeof(NTAccount)) as NTAccount;
			if (account == null)
			{
				Console.Error.WriteLine("SID is not mapped to an account: " + args[1]);
				return 1;
			}

			Console.WriteLine(account.Value);
			return 0;
		}
		catch (IdentityNotMappedException)
		{
			Console.Error.WriteLine("SID is not mapped to an account: " + args[1]);
			return 1;
		}
		catch (Exception exception)
		{
			Console.Error.WriteLine(exception.Message);
			return 1;
		}
	}

	private static int SeedSecurityDescriptor(string[] args)
	{
		if (args.Length != 3)
		{
			PrintUsage();
			return 2;
		}

		try
		{
			if (File.Exists(args[1]))
			{
				FileSecurity security = File.GetAccessControl(args[1]);
				security.SetSecurityDescriptorSddlForm(args[2], AccessControlSections.Access);
				File.SetAccessControl(args[1], security);
				return 0;
			}

			if (Directory.Exists(args[1]))
			{
				DirectorySecurity security = Directory.GetAccessControl(args[1]);
				security.SetSecurityDescriptorSddlForm(args[2], AccessControlSections.Access);
				Directory.SetAccessControl(args[1], security);
				return 0;
			}

			Console.Error.WriteLine("Path does not exist: " + args[1]);
			return 1;
		}
		catch (Exception exception)
		{
			Console.Error.WriteLine(exception.Message);
			return 1;
		}
	}

	private static int RunWithoutPrivileges(string[] args)
	{
		if (args.Length < 4)
		{
			PrintUsage();
			return 2;
		}

		string[] privilegeNames = args[1].Split(new[] { ',' }, StringSplitOptions.None);
		foreach (string privilegeName in privilegeNames)
		{
			if (privilegeName.Length == 0)
			{
				Console.Error.WriteLine("Privilege names must be comma-separated and non-empty.");
				return 2;
			}
		}

		try
		{
			RemovePrivileges(privilegeNames);
			ProcessStartInfo startInfo = new ProcessStartInfo
			{
				FileName = args[2],
				Arguments = QuoteArguments(args, 3),
				UseShellExecute = false,
				RedirectStandardOutput = true,
				RedirectStandardError = true,
				CreateNoWindow = true
			};
			return RunProcess(startInfo, "Child process");
		}
		catch (Exception exception)
		{
			Console.Error.WriteLine(exception.Message);
			return 1;
		}
	}

	private static int PrintMetadata(string[] args)
	{
		if (args.Length != 1)
		{
			PrintUsage();
			return 2;
		}

		try
		{
			string icaclsPath = Path.Combine(Environment.SystemDirectory, "icacls.exe");
			string icaclsVersion = File.Exists(icaclsPath) ? FileVersionInfo.GetVersionInfo(icaclsPath).FileVersion : String.Empty;
			Console.WriteLine("{\"osVersion\":\"" + JsonEscape(GetActualOsVersion()) + "\",\"culture\":\"" + JsonEscape(CultureInfo.CurrentCulture.Name) + "\",\"uiCulture\":\"" + JsonEscape(CultureInfo.CurrentUICulture.Name) + "\",\"icaclsPath\":\"" + JsonEscape(icaclsPath) + "\",\"icaclsFileVersion\":\"" + JsonEscape(icaclsVersion) + "\",\"icaclsMachine\":\"" + JsonEscape(GetPeMachine(icaclsPath)) + "\",\"processBitness\":\"" + (Environment.Is64BitProcess ? "64" : "32") + "\",\"operatingSystemBitness\":\"" + (Environment.Is64BitOperatingSystem ? "64" : "32") + "\",\"processorArchitecture\":\"" + JsonEscape(Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE")) + "\",\"wow64ProcessorArchitecture\":\"" + JsonEscape(Environment.GetEnvironmentVariable("PROCESSOR_ARCHITEW6432")) + "\"}");
			return 0;
		}
		catch (Exception exception)
		{
			Console.Error.WriteLine(exception.Message);
			return 1;
		}
	}

	private static int SetOwner(string[] args)
	{
		if (args.Length != 3) { PrintUsage(); return 2; }
		try
		{
			EnablePrivilege("SeRestorePrivilege");
			SecurityIdentifier owner = new SecurityIdentifier(args[2]);
			if (File.Exists(args[1])) { FileSecurity security = File.GetAccessControl(args[1], AccessControlSections.Owner); security.SetOwner(owner); File.SetAccessControl(args[1], security); return 0; }
			if (Directory.Exists(args[1])) { DirectorySecurity security = Directory.GetAccessControl(args[1], AccessControlSections.Owner); security.SetOwner(owner); Directory.SetAccessControl(args[1], security); return 0; }
			Console.Error.WriteLine("Path does not exist: " + args[1]); return 1;
		}
		catch (Exception exception) { Console.Error.WriteLine(exception.Message); return 1; }
	}

	private static int HoldFile(string[] args)
	{
		if (args.Length != 5) { PrintUsage(); return 2; }
		FileShare share;
		if (!TryParseFileShare(args[4], out share)) { Console.Error.WriteLine("Share must be read, readwrite, all, or none."); return 2; }
		try
		{
			using (FileStream stream = new FileStream(args[1], FileMode.Open, FileAccess.Read, share))
			{
				File.WriteAllText(args[2], String.Empty);
				DateTime deadline = DateTime.UtcNow.AddSeconds(120);
				while (!File.Exists(args[3]) && DateTime.UtcNow < deadline) { Thread.Sleep(100); }
				if (!File.Exists(args[3])) { Console.Error.WriteLine("Timed out waiting for stop file: " + args[3]); return 1; }
			}
			return 0;
		}
		catch (Exception exception) { Console.Error.WriteLine(exception.Message); return 1; }
	}

	private static int ReadFile(string[] args)
	{
		if (args.Length != 2) { PrintUsage(); return 2; }
		try
		{
			using (FileStream stream = new FileStream(args[1], FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
			using (SHA256 hash = SHA256.Create()) { Console.WriteLine(ToHex(hash.ComputeHash(stream))); }
			return 0;
		}
		catch (Exception exception) { Console.Error.WriteLine(exception.Message); return 1; }
	}

	private static int ProbeFile(string[] args)
	{
		if (args.Length != 3) { PrintUsage(); return 2; }
		try
		{
			if (string.Equals(args[2], "read", StringComparison.OrdinalIgnoreCase)) { using (FileStream stream = new FileStream(args[1], FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) { stream.ReadByte(); } }
			else if (string.Equals(args[2], "write", StringComparison.OrdinalIgnoreCase)) { using (FileStream stream = new FileStream(args[1], FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete)) { stream.WriteByte(0); } }
			else { Console.Error.WriteLine("Operation must be read or write."); return 2; }
			Console.WriteLine("ok"); return 0;
		}
		catch (Exception exception) { Console.Error.WriteLine(exception.Message); return 1; }
	}

	private static int SeedSacl(string[] args)
	{
		if (args.Length != 2) { PrintUsage(); return 2; }

		try
		{
			EnablePrivilege("SeSecurityPrivilege");
			FileSecurity security = new FileSecurity();
			SecurityIdentifier everyone = new SecurityIdentifier(WellKnownSidType.WorldSid, null);
			security.AddAuditRule(new FileSystemAuditRule(everyone, FileSystemRights.WriteData, AuditFlags.Success | AuditFlags.Failure));
			File.SetAccessControl(args[1], security);
			return 0;
		}
		catch (Exception exception) { Console.Error.WriteLine(exception.Message); return 1; }
	}

	private static int PrintSaclSnapshot(string[] args)
	{
		if (args.Length != 2) { PrintUsage(); return 2; }

		try
		{
			EnablePrivilege("SeSecurityPrivilege");
			Console.WriteLine(File.GetAccessControl(args[1], AccessControlSections.Audit).GetSecurityDescriptorSddlForm(AccessControlSections.Audit));
			return 0;
		}
		catch (Exception exception) { Console.Error.WriteLine(exception.Message); return 1; }
	}

	private static bool TryParseFileShare(string value, out FileShare share)
	{
		if (string.Equals(value, "read", StringComparison.OrdinalIgnoreCase)) { share = FileShare.Read; return true; }
		if (string.Equals(value, "readwrite", StringComparison.OrdinalIgnoreCase)) { share = FileShare.Read | FileShare.Write; return true; }
		if (string.Equals(value, "all", StringComparison.OrdinalIgnoreCase)) { share = FileShare.Read | FileShare.Write | FileShare.Delete; return true; }
		if (string.Equals(value, "none", StringComparison.OrdinalIgnoreCase)) { share = FileShare.None; return true; }
		share = FileShare.None; return false;
	}

	private static string ToHex(byte[] bytes)
	{
		StringWriter writer = new StringWriter(CultureInfo.InvariantCulture);
		foreach (byte value in bytes) { writer.Write(value.ToString("x2", CultureInfo.InvariantCulture)); }
		return writer.ToString();
	}

	private static string GetActualOsVersion()
	{
		RtlOsVersionInfo version = new RtlOsVersionInfo();
		version.Size = Marshal.SizeOf(typeof(RtlOsVersionInfo));
		int status = RtlGetVersion(ref version);
		if (status != 0) { throw new InvalidOperationException("RtlGetVersion failed with status " + status.ToString(CultureInfo.InvariantCulture) + "."); }
		return version.MajorVersion.ToString(CultureInfo.InvariantCulture) + "." + version.MinorVersion.ToString(CultureInfo.InvariantCulture) + "." + version.BuildNumber.ToString(CultureInfo.InvariantCulture);
	}

	private static string GetPeMachine(string path)
	{
		if (!File.Exists(path)) { return String.Empty; }
		using (FileStream stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
		using (BinaryReader reader = new BinaryReader(stream))
		{
			if (stream.Length < 64 || reader.ReadUInt16() != 0x5a4d) { throw new InvalidOperationException("icacls.exe is not a valid PE file."); }
			stream.Position = 60; uint peOffset = reader.ReadUInt32();
			if (peOffset > stream.Length - 6) { throw new InvalidOperationException("icacls.exe has an invalid PE header offset."); }
			stream.Position = peOffset;
			if (reader.ReadUInt32() != 0x00004550) { throw new InvalidOperationException("icacls.exe is not a valid PE file."); }
			return PeMachineName(reader.ReadUInt16());
		}
	}

	private static string PeMachineName(ushort machine)
	{
		switch (machine) { case 0x014c: return "x86"; case 0x8664: return "x64"; case 0xaa64: return "arm64"; case 0x01c0: return "arm"; default: return "0x" + machine.ToString("x4", CultureInfo.InvariantCulture); }
	}

	private static void RemovePrivileges(string[] privilegeNames)
	{
		foreach (string privilegeName in privilegeNames)
		{
			AdjustPrivilege(privilegeName, SePrivilegeRemoved);
		}
	}

	private static void EnablePrivilege(string privilegeName)
	{
		AdjustPrivilege(privilegeName, SePrivilegeEnabled);
	}

	private static void AdjustPrivilege(string privilegeName, uint attributes)
	{
		IntPtr token;
		if (!OpenProcessToken(Process.GetCurrentProcess().Handle, TokenAdjustPrivileges | TokenQuery, out token))
		{
			ThrowLastWin32Error("OpenProcessToken failed");
		}

		using (TokenHandle tokenHandle = new TokenHandle(token))
		{
			Luid luid;
			if (!LookupPrivilegeValue(null, privilegeName, out luid))
			{
				ThrowLastWin32Error("LookupPrivilegeValue failed for " + privilegeName);
			}

			TokenPrivileges privileges = new TokenPrivileges();
			privileges.PrivilegeCount = 1;
			privileges.Privileges.Luid = luid;
			privileges.Privileges.Attributes = attributes;
			SetLastError(0);
			if (!AdjustTokenPrivileges(tokenHandle.Handle, false, ref privileges, 0, IntPtr.Zero, IntPtr.Zero))
			{
				ThrowLastWin32Error("AdjustTokenPrivileges failed for " + privilegeName);
			}

			if (Marshal.GetLastWin32Error() == ErrorNotAllAssigned)
			{
				throw new InvalidOperationException("Privilege is not assigned to this process token: " + privilegeName);
			}
		}
	}

	private static int RunProcess(ProcessStartInfo startInfo, string processDescription)
	{
		using (Process process = new Process())
		using (ManualResetEvent outputCompleted = new ManualResetEvent(false))
		using (ManualResetEvent errorCompleted = new ManualResetEvent(false))
		{
			process.StartInfo = startInfo;
			process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
			{
				if (eventArgs.Data == null)
				{
					outputCompleted.Set();
				}
				else
				{
					Console.Out.WriteLine(eventArgs.Data);
				}
			};
			process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
			{
				if (eventArgs.Data == null)
				{
					errorCompleted.Set();
				}
				else
				{
					Console.Error.WriteLine(eventArgs.Data);
				}
			};

			if (!process.Start())
			{
				Console.Error.WriteLine("Failed to start " + processDescription.ToLowerInvariant() + ".");
				return 1;
			}

			process.BeginOutputReadLine();
			process.BeginErrorReadLine();
			DateTime deadline = DateTime.UtcNow.AddMilliseconds(ProcessTimeoutMilliseconds);
			if (!process.WaitForExit(RemainingMilliseconds(deadline)))
			{
				Console.Error.WriteLine(processDescription + " timed out after 10 minutes.");
				try
				{
					process.Kill();
				}
				catch (InvalidOperationException)
				{
				}

				return TimeoutExitCode;
			}

			WaitHandle.WaitAll(new WaitHandle[] { outputCompleted, errorCompleted }, RemainingMilliseconds(deadline));
			return process.ExitCode;
		}
	}

	private static SecureString CreateSecureString(string value)
	{
		SecureString password = new SecureString();
		foreach (char character in value)
		{
			password.AppendChar(character);
		}

		password.MakeReadOnly();
		return password;
	}

	private static int RemainingMilliseconds(DateTime deadline)
	{
		double milliseconds = (deadline - DateTime.UtcNow).TotalMilliseconds;
		if (milliseconds <= 0)
		{
			return 0;
		}

		return milliseconds > Int32.MaxValue ? Int32.MaxValue : (int)Math.Ceiling(milliseconds);
	}

	private static string QuoteArguments(string[] args, int firstArgumentIndex)
	{
		StringWriter writer = new StringWriter();
		for (int index = firstArgumentIndex; index < args.Length; index++)
		{
			if (index > firstArgumentIndex)
			{
				writer.Write(' ');
			}
			writer.Write(QuoteArgument(args[index]));
		}
		return writer.ToString();
	}

	private static string QuoteArgument(string value)
	{
		if (value.Length == 0)
		{
			return "\"\"";
		}

		StringWriter writer = new StringWriter();
		writer.Write('"');
		int backslashCount = 0;
		foreach (char character in value)
		{
			if (character == '\\')
			{
				backslashCount++;
				continue;
			}

			if (character == '"')
			{
				writer.Write(new string('\\', (backslashCount * 2) + 1));
				writer.Write(character);
				backslashCount = 0;
				continue;
			}

			writer.Write(new string('\\', backslashCount));
			writer.Write(character);
			backslashCount = 0;
		}

		writer.Write(new string('\\', backslashCount * 2));
		writer.Write('"');
		return writer.ToString();
	}

	private static string JsonEscape(string value)
	{
		return (value ?? String.Empty).Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
	}

	private static void ThrowLastWin32Error(string message)
	{
		throw new InvalidOperationException(message + ": " + new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()).Message);
	}

	private static void PrintUsage()
	{
		Console.Error.WriteLine("Usage:");
		Console.Error.WriteLine("  acl-diagnosis-runner run <username> <password> <nodeExe> <scriptPath> <root> <phase>");
		Console.Error.WriteLine("  acl-diagnosis-runner owner <path>");
		Console.Error.WriteLine("  acl-diagnosis-runner snapshot <path>");
		Console.Error.WriteLine("  acl-diagnosis-runner sid <account>");
		Console.Error.WriteLine("  acl-diagnosis-runner resolve <SID>");
		Console.Error.WriteLine("  acl-diagnosis-runner seed <path> <sddl>");
		Console.Error.WriteLine("  acl-diagnosis-runner without <privilege1,privilege2> <exe> <arguments...>");
		Console.Error.WriteLine("  acl-diagnosis-runner metadata");
		Console.Error.WriteLine("  acl-diagnosis-runner setowner <path> <sid>");
		Console.Error.WriteLine("  acl-diagnosis-runner hold <path> <readyFile> <stopFile> <read|readwrite|all|none>");
		Console.Error.WriteLine("  acl-diagnosis-runner read <path>");
		Console.Error.WriteLine("  acl-diagnosis-runner probe <path> <read|write>");
		Console.Error.WriteLine("  acl-diagnosis-runner saclseed <path>");
		Console.Error.WriteLine("  acl-diagnosis-runner saclsnapshot <path>");
	}

	[DllImport("ntdll.dll")]
	private static extern int RtlGetVersion(ref RtlOsVersionInfo versionInformation);

	[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
	private static extern bool OpenProcessToken(IntPtr processHandle, uint desiredAccess, out IntPtr tokenHandle);

	[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
	private static extern bool LookupPrivilegeValue(string systemName, string name, out Luid luid);

	[DllImport("advapi32.dll", SetLastError = true)]
	private static extern bool AdjustTokenPrivileges(IntPtr tokenHandle, bool disableAllPrivileges, ref TokenPrivileges newState, uint bufferLength, IntPtr previousState, IntPtr returnLength);

	[DllImport("kernel32.dll")]
	private static extern void SetLastError(uint error);

	[DllImport("kernel32.dll", SetLastError = true)]
	private static extern bool CloseHandle(IntPtr handle);

	[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
	private struct RtlOsVersionInfo
	{
		public int Size;
		public int MajorVersion;
		public int MinorVersion;
		public int BuildNumber;
		public int PlatformId;
		[MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
		public string CsdVersion;
	}

	[StructLayout(LayoutKind.Sequential)]
	private struct Luid
	{
		public uint LowPart;
		public int HighPart;
	}

	[StructLayout(LayoutKind.Sequential)]
	private struct LuidAndAttributes
	{
		public Luid Luid;
		public uint Attributes;
	}

	[StructLayout(LayoutKind.Sequential)]
	private struct TokenPrivileges
	{
		public uint PrivilegeCount;
		public LuidAndAttributes Privileges;
	}

	private sealed class TokenHandle : IDisposable
	{
		public TokenHandle(IntPtr handle)
		{
			Handle = handle;
		}

		public IntPtr Handle { get; private set; }

		public void Dispose()
		{
			if (Handle != IntPtr.Zero)
			{
				CloseHandle(Handle);
				Handle = IntPtr.Zero;
			}
		}
	}
}

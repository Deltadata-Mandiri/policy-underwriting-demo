// Sample users for the demo kit (demo-kit.js). Personas, not accounts: the
// sign-in decides who this console acts as, and the name lands in the
// workflow input (requestedBy) and the underwriter review (reviewedBy).
window.DEMO_CONFIG = {
  key: 'policy',
  brand: 'BDN Life',
  app: 'BDN Life Insurance',
  title: 'Sistem Underwriting Asuransi Jiwa',
  lead: 'Spesialis Bancassurance mengajukan polis term-life; workflow Orkes menilai risiko medis dan finansial lalu menyusun surat keputusan. Kasus ambang batas dan kasus besar dirujuk ke Underwriter — yang tidak boleh memutuskan pengajuannya sendiri.',
  password: 'bdn-demo',
  workflows: { policy_underwriting: 'Policy underwriting' },
  roles: { agent: 'Bancassurance (Maker)', underwriter: 'Underwriter (Checker)' },
  personas: [
    { id: 'sari', name: 'Sari Wulandari', title: 'Bancassurance Specialist', unit: 'KC Bandung Asia Afrika', roles: ['agent'],
      hint: 'Ajukan polis calon tertanggung. Coba “Contoh Tinjauan” atau “Contoh Kasus Besar”.' },
    { id: 'agus', name: 'Agus Setiawan', title: 'Senior Underwriter', unit: 'Divisi Underwriting', roles: ['underwriter'],
      hint: 'Putuskan pengajuan yang dirujuk: setujui dengan loading, tolak, atau tunda.' },
    { id: 'lestari', name: 'Lestari Handayani', title: 'Chief Underwriter', unit: 'Kantor Pusat BDN Life', roles: ['agent', 'underwriter'],
      hint: 'Bisa mengajukan dan meninjau — tetapi tidak meninjau pengajuannya sendiri.' },
  ],
};

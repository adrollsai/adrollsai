const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { createClient } = require('@supabase/supabase-js');

// R2 Config
const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

// Supabase Admin Config
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

// Lists of URLs to seed
const premiumUrls = [
  "https://i.pinimg.com/736x/5c/6e/73/5c6e7377d223f11e9a7b5e2cade357be.jpg",
  "https://i.pinimg.com/736x/cc/bf/6e/ccbf6e2fb185273923bb887deb207265.jpg",
  "https://i.pinimg.com/736x/e0/28/eb/e028ebfb4a78b8be6d3c7450a02393e5.jpg",
  "https://i.pinimg.com/736x/98/13/ed/9813edf38331188a839d680158224a4f.jpg",
  "https://i.pinimg.com/736x/28/c3/88/28c388f014ccbbe19bc68e643159bd80.jpg",
  "https://i.pinimg.com/736x/c7/22/b7/c722b7fc7f4c01ede490ed2c8adc4854.jpg",
  "https://i.pinimg.com/736x/ff/93/d6/ff93d6b99a3fe8aa202ccb9ceee8216a.jpg",
  "https://i.pinimg.com/736x/58/d8/64/58d86473ec285fd740d5946456e1c093.jpg",
  "https://i.pinimg.com/736x/1e/23/bf/1e23bf0faa3f8c2747c289f45187b29c.jpg",
  "https://i.pinimg.com/736x/f4/0c/59/f40c59108fcc6f2ea83f86263770b1e9.jpg",
  "https://i.pinimg.com/736x/36/7b/14/367b14e84e393f8eb658ec5651d4aed6.jpg",
  "https://i.pinimg.com/736x/09/11/55/091155563b7b850c0fd15e65984088c6.jpg",
  "https://i.pinimg.com/736x/16/2a/a2/162aa2a558e8de39fd268f64ee877cbc.jpg",
  "https://i.pinimg.com/736x/ee/0c/8a/ee0c8a2664f3b0bb5db487bacebab389.jpg",
  "https://i.pinimg.com/736x/e9/d6/88/e9d688e3b045a47ccf56cddeb00dcdc2.jpg",
  "https://i.pinimg.com/736x/a7/07/85/a707851cff855b85dd5e88fa925db75b.jpg",
  "https://i.pinimg.com/736x/ad/4c/2c/ad4c2c268665219f6e51773fa1e58198.jpg",
  "https://i.pinimg.com/736x/17/31/5b/17315b9e929d29ce1d4607c715823a28.jpg",
  "https://i.pinimg.com/736x/ec/f8/2f/ecf82fb07864aa28fce875d08b1a238a.jpg",
  "https://i.pinimg.com/736x/9a/46/8c/9a468cffac3958fb759e29600e53c7fe.jpg",
  "https://i.pinimg.com/736x/c7/73/6a/c7736a9a3ba9a62e1371cac4cacd53b0.jpg",
  "https://i.pinimg.com/736x/cd/5b/b0/cd5bb0ca97c0581e273d3007c0433d1e.jpg",
  "https://i.pinimg.com/736x/b7/fe/e1/b7fee1852875ef497056d36438eb99c9.jpg",
  "https://i.pinimg.com/736x/1e/7b/7d/1e7b7d4f76f80c6f781a4d527b3004a8.jpg",
  "https://i.pinimg.com/736x/89/24/99/892499e1301a2628bea3edbfcd92cdda.jpg"
];

const edmUrls = [
  "https://i.pinimg.com/736x/4c/71/5c/4c715c1ac720857c3c5cfcfd6ac556ef.jpg",
  "https://i.pinimg.com/736x/c4/b1/cb/c4b1cb1ce0803aa6c4ace475d446d367.jpg",
  "https://i.pinimg.com/736x/bf/e9/2a/bfe92a8a80925950fa8682ee06f24a28.jpg",
  "https://i.pinimg.com/736x/a4/f1/92/a4f19275c08ae64ead62795564ce2891.jpg",
  "https://i.pinimg.com/736x/ce/01/58/ce01587f29da7a6f4b7504c7e673691d.jpg",
  "https://i.pinimg.com/736x/11/10/88/1110889f3ed6b95ddbf9aea564d2c579.jpg",
  "https://i.pinimg.com/736x/e9/03/af/e903afbf91298d81f323d9379424ad4d.jpg",
  "https://i.pinimg.com/736x/98/69/64/986964c12810666091b8718b35617940.jpg",
  "https://i.pinimg.com/736x/db/36/d3/db36d3a83ce1c76dda6e4a0bdf7b0979.jpg",
  "https://i.pinimg.com/736x/5a/d3/3f/5ad33f8d05668f142f473785a92c149b.jpg",
  "https://i.pinimg.com/736x/1d/61/5d/1d615d39ce714b74232735779e34e554.jpg",
  "https://i.pinimg.com/736x/b8/c1/de/b8c1dee1496d3d486c03770f087d7e1e.jpg",
  "https://i.pinimg.com/736x/9f/ab/e5/9fabe5d65f8c1e644c8bd7fe8af5eeef.jpg",
  "https://i.pinimg.com/736x/6d/c5/c4/6dc5c495b52bc4a7fea161457dbbb189.jpg",
  "https://i.pinimg.com/736x/06/32/01/0632017fcba169f430f067837afa9e32.jpg",
  "https://i.pinimg.com/736x/d8/ef/d1/d8efd12b783f1e04c8ef58a0bdbd27ce.jpg",
  "https://i.pinimg.com/736x/44/99/3d/44993dd22f9fc51f8396dee2a883537e.jpg",
  "https://i.pinimg.com/736x/07/97/51/079751eb694aed65ac53088d4f2c50c7.jpg",
  "https://i.pinimg.com/736x/7c/2c/c4/7c2cc4c9a9b766be11e2795677a23da7.jpg",
  "https://i.pinimg.com/736x/1c/63/7b/1c637ba6f762de03d5e0c6aeca96c56a.jpg",
  "https://i.pinimg.com/736x/64/44/df/6444df481ebbcc27e54f7aebeb4e22c1.jpg",
  "https://i.pinimg.com/736x/35/53/35/3553355f3f4f0b4183975dd7f2c3800e.jpg",
  "https://i.pinimg.com/736x/49/d1/3c/49d13cda609fc82119a174c0181abe11.jpg",
  "https://i.pinimg.com/736x/28/d4/c6/28d4c67997b38ecd8aa5f471b1255898.jpg",
  "https://i.pinimg.com/736x/15/e5/9f/15e59f70c1ff4b188e6421f91bd0e2cb.jpg"
];

const highConvertingUrls = [
  "https://scontent.fixc1-4.fna.fbcdn.net/v/t39.35426-6/603954083_1363160782114392_6234243086726583155_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=101&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=yqVf8fK7mxgQ7kNvwGoPI-G&_nc_oc=Ado2ScK53uogX-z0PpSLzyCvUxdt7RatNL2CWLsw_IJkC717dYa8HPErhNcvN5_FYRYC4M-9-otPpnUru9APtrIv&_nc_zt=14&_nc_ht=scontent.fixc1-4.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af-DNty61GMPjMGETF5Q4d8Y8vKFFDwefkH6TRkpTdTCqw&oe=6A3451FD",
  "https://scontent.fixc1-7.fna.fbcdn.net/v/t39.35426-6/600480760_797301963371395_5555763810444030145_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=103&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=kcNQUcuofyMQ7kNvwHO1ae1&_nc_oc=AdoMR0vTsVmneY5_EXMQjKfJ5tWDhrKzCjinN3IV77LxH4AHq7eqKyBq2ilP_T80ynRr16hUMnq8DmvHD06GH_ib&_nc_zt=14&_nc_ht=scontent.fixc1-7.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af9jf2O4JQD4EMZ0gReAPrsA4Psqwh0uFDS1rOo-fqFo2g&oe=6A342622",
  "https://scontent.fixc1-5.fna.fbcdn.net/v/t39.35426-6/600393894_2694023390929999_382740455699491268_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=109&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=UZAsSmsZmYsQ7kNvwF--Vpq&_nc_oc=AdpOSInRqSfuVJcDvcb3H4MihyAuY0TSBfziKgTEV_53nmMoEDTGCfBf3X2s9RYEEaXgIOnHA1CRJqK5RuJHRADi&_nc_zt=14&_nc_ht=scontent.fixc1-5.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af8giREuFnmZC3f68dgGVeWu6fQiq6-MrbxxSOKefNJR7w&oe=6A34341D",
  "https://scontent.fixc1-7.fna.fbcdn.net/v/t39.35426-6/682422063_896065346785795_531491571143538235_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=103&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=aJ2gvODx54UQ7kNvwG9q-a3&_nc_oc=AdosfTXzonYqwsR1ISHREVgsv9LzcehaRBLtIkViPUXhYfGgWjoMyIFGmTzXc-6VaCFp_4lhWpHsFWQgu5YlvoWS&_nc_zt=14&_nc_ht=scontent.fixc1-7.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af9zF8KJJemGHxSuvjyvZT8Q1hW44HKcyawW_tW57X3A3A&oe=6A3441D4",
  "https://scontent.fixc1-7.fna.fbcdn.net/v/t39.35426-6/601403564_1182301254024755_272310277082544812_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=108&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=czHeCATjqBkQ7kNvwGSSL_1&_nc_oc=Adq_8oPJuJ0MyWatzgj4d3jOeOgUcCGbZw4VkXOHsZg1LRZgKSjimOF4AaCG_4Mlfg5t8oOOMRL75vUyvuzBHAOA&_nc_zt=14&_nc_ht=scontent.fixc1-7.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af_4xWlGbljMYhB5mdgJicq72lWvFOdvHCxiL2-6u8J4lg&oe=6A3426A0",
  "https://scontent.fixc1-12.fna.fbcdn.net/v/t39.35426-6/598303053_1224244619591507_8654485517994244975_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=111&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=Xz6t6VuApe0Q7kNvwH2WI4l&_nc_oc=Adpz2eyzwlBC9iN_4iAelvaUTh8NoULZGjFqKi23LfnCc-5F-wQTuXXfczRR8e_TOMF9l6CZ4H-nPV5J6R74TexQ&_nc_zt=14&_nc_ht=scontent.fixc1-12.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af9IrEq6eq4KCt75_xbyae8XcGH2J_KGW0ZvdxtcT1pKAA&oe=6A343967",
  "https://scontent.fixc1-12.fna.fbcdn.net/v/t39.35426-6/598519125_868270975586904_8492384437114671337_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=106&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=-x9DFnFJZ14Q7kNvwEgos8h&_nc_oc=AdqM_Eg_6s1k3wTO_o8IHyYOy-DXK3AwCIdjsy7lTtRQdJG9xc5hsZOZGE4aKnU-8B1dej_sCBrLhwPTTZ9t7-lR&_nc_zt=14&_nc_ht=scontent.fixc1-12.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af9-GuDUXWWtnE9b8bdTaGjg53JsVG_LrMBmpzpxqIdP9A&oe=6A3428AF",
  "https://scontent.fixc1-11.fna.fbcdn.net/v/t39.35426-6/597154831_24378187128524927_2511693048455325481_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=107&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=tlm0xITuwEoQ7kNvwG3JwqE&_nc_oc=AdqeDOzstvS1uwdtQVpVJ66XWdo-4TqWjo56-Xl7XEiqHgIEPYfPcJOC2ZmYF0xRmSLKuksXXIlZEemkIGPsgK-y&_nc_zt=14&_nc_ht=scontent.fixc1-11.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af-7wYdRh2qj2jtJpXiVpIkgTBE-UgOQSwzLEJTeSkyz1w&oe=6A344CBE",
  "https://scontent.fixc1-7.fna.fbcdn.net/v/t39.35426-6/600295531_625327927304818_3709198749059436094_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=108&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=3b31Rn0D2hAQ7kNvwEm2KfG&_nc_oc=AdqsBcBNW0o-0cPkqrAXW-EhEdhdKP6g52ebiEVFBAujC24IRjNxNk-IyWb2b_QR8qKP7GbWISq4H0uLtsA8emsA&_nc_zt=14&_nc_ht=scontent.fixc1-7.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af8d6RM18ZZg3au8_p7twyuO4MZR-Y2AA4k2kuJlv96zqA&oe=6A342B95",
  "https://scontent.fixc1-6.fna.fbcdn.net/v/t39.35426-6/597076769_795796903502627_5498943860997143998_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=102&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=czw513WtUG4Q7kNvwEAyZFy&_nc_oc=Adr3BQm1Z1FJP9UJBWtVBXWWJFwrz17FAsR6YILhR2cvVTs2YsPbQfVnrUbp1NnGUz5lVeWOJC-kfg_W0krzGoSY&_nc_zt=14&_nc_ht=scontent.fixc1-6.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af9ThYFH-a37ICRetTCWzTrQFw0p44HPhIpOimHlVZw-7Q&oe=6A341FEE",
  "https://scontent.fixc1-7.fna.fbcdn.net/v/t39.35426-6/599929111_25638208279145817_2331992357026295127_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=108&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=PVdLVRFfktcQ7kNvwH59Y0c&_nc_oc=AdqoxQSwwnbA4wJ1q0c34VLgIp7dcDHycLLi9O1us776CqX4uoF02OZTMthY0PVcjwbg2Qpqk-05qfXNu3T5i75l&_nc_zt=14&_nc_ht=scontent.fixc1-7.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af8DL0lRxG5IExYF3J3LuPJFBj_E-pdRu9FIwIcD17l7LQ&oe=6A34463D",
  "https://scontent.fixc1-4.fna.fbcdn.net/v/t39.35426-6/598616545_4186147528275899_8047732808435000517_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=100&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=FFjlcP2ubl4Q7kNvwEINZRy&_nc_oc=Adr_PX6xEhFw9SVGlRsboWBKKYs8IU2Yfl_d5O5XwXE5sh2itUa4q_7bt8OIltKbUln4MoUuxpVnPmNVnc5H0YMj&_nc_zt=14&_nc_ht=scontent.fixc1-4.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af-45lKmMn8lwMBux8erMQQvfjM3H-x5msOSLuIUZWREjQ&oe=6A34240A",
  "https://scontent.fixc1-12.fna.fbcdn.net/v/t39.35426-6/599622729_835532612704112_9131874334392327476_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=106&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=HTZ4TNZK0YQQ7kNvwE0bj5c&_nc_oc=AdpHriWHqKCJisZg9q7vi3NfR9RFWSO5avaXEg1AmsdcXNZ09apZZHuC1c8GUM6tMQJXdc0nyr6H6zBa3QQ-2xYG&_nc_zt=14&_nc_ht=scontent.fixc1-12.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af95UngdmM0fp6nfj5TK_XFkUFax7AH0cDYefgTgjHMeXg&oe=6A342378",
  "https://scontent.fixc1-12.fna.fbcdn.net/v/t39.35426-6/649667456_917399407560739_7644017934664353615_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=106&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=MqAnUHXiT5UQ7kNvwEg3oFw&_nc_oc=AdpNzlTdi11Iq9zzKP11Xl2wmIEcmbqIUK_-XbnD71j2tdw9cTvaUtQxTlRosR0k_Wg6MzjCr84WLQdKL5_Cv9BH&_nc_zt=14&_nc_ht=scontent.fixc1-12.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af-uyXo--_wZKHicNNP7usf7C4yhOrx-rDTVvP8kGNG9lA&oe=6A34407B",
  "https://scontent.fixc1-11.fna.fbcdn.net/v/t39.35426-6/600339893_836163702527555_6523530150709305398_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=107&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=Au1dFs1xpIgQ7kNvwETLc4g&_nc_oc=Adp4CzN0nLhlIJJcwNPnjWVWP3XZjji418oda5WQIZhGnxD_feXT5jpnOD5O9vcnXMnO4dH5OlHh3JQU5L0qbTjm&_nc_zt=14&_nc_ht=scontent.fixc1-11.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af9Y4CrVYDJAlL-ALL3EwhmE5ReUhNqgTVRL1-f6xpxxfg&oe=6A344C92",
  "https://scontent.fixc1-7.fna.fbcdn.net/v/t39.35426-6/616015800_877598691722630_6655059378477833512_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=108&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=33-p04lnZU0Q7kNvwEjNkdR&_nc_oc=Adr-TCLVJ7GMW7CNEcwiv2a4-BSLtijytiRfGqGU48McnzrZMeq26z6BlcGSvOn1-O4nZeaPWpS_f6geN060waO-&_nc_zt=14&_nc_ht=scontent.fixc1-7.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af8ul1KLc6vdEbZDIllFEprsr4i0Rn2jd4yk3zU66GaNEg&oe=6A344713",
  "https://scontent.fixc1-7.fna.fbcdn.net/v/t39.35426-6/490353386_1165264825093556_2407488088503115428_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=103&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=iAM37Tf-cjoQ7kNvwEIj8Fq&_nc_oc=Ado_UIEGxo9TN4p8CT4UbL9cuhhHuDmJ8ZbqM9VZO-FcOwViqzDRn3WPVaa5hdKWvqa6zUpT3iXurEJ7nCt7xuax&_nc_zt=14&_nc_ht=scontent.fixc1-7.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af-VW2UmC9LlFWYwDPyr1CTScSS-RtF9kDy0-_U_af2Clw&oe=6A34343B",
  "https://scontent.fixc1-4.fna.fbcdn.net/v/t39.35426-6/649104703_1610964646719914_1981378599857214660_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=100&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=Vtpqi6vbHYwQ7kNvwFU4gFE&_nc_oc=Adr4D-skW0bFRC5yP5gz-pS-OlsQUNTnJwo6fScAKqLZxMOBuixojwrnUEeVxQCQop3SG1DxCMqUvWJfkwniYrxH&_nc_zt=14&_nc_ht=scontent.fixc1-4.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af_2We3yIIV3GF_EvmBhzVQNqXDogG7AzQCEYdvV-i_G6w&oe=6A343124",
  "https://scontent.fixc1-7.fna.fbcdn.net/v/t39.35426-6/659172900_1372365441466322_1612306790054339962_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=108&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=iTCAqLbiso8Q7kNvwFGSfUW&_nc_oc=AdqsnbK8swfyq4rvlV7Gv-Tm2imIPfR7jVcTIBfHWavWBj_PHM8N4LMBOaoTUxGnFO_5x8VWe5aUxPCFs-DTFlbK&_nc_zt=14&_nc_ht=scontent.fixc1-7.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af-bgr04xA1IkFx8v9C2j6-MlxXsJo1mQ8yyV5qhKQK5UQ&oe=6A3428F1",
  "https://scontent.fixc1-5.fna.fbcdn.net/v/t39.35426-6/643733385_4207052652843291_4524064467517113336_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=110&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=6K3YANJBJdgQ7kNvwF2wk99&_nc_oc=Adr6oyzMEC7algZ11AwQSCWlm1_sTihqUl4P7YrjFTUEYfgC3IT5Fa6scIYU5970n_OgNQ79Tj1Z9zJm5XNcxgVU&_nc_zt=14&_nc_ht=scontent.fixc1-5.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af-XErrTouuq1x1mVkRZwSHCmx1L0Yc6OPtY98iPwE1CGQ&oe=6A342FA9",
  "https://scontent.fixc1-4.fna.fbcdn.net/v/t39.35426-6/597669066_1166785079002715_6902957521886917160_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=100&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=1Uv-OuWEgA8Q7kNvwGRrLRm&_nc_oc=Adp1kgyiEu2prF4G_YxLFYscXOUj3jrzN09OtQN6Mrw_v_oJX52rPln5qssY78bmFf41lRTxYBzjuSc28CRbmN0c&_nc_zt=14&_nc_ht=scontent.fixc1-4.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af9inblcQxjE-5GbYOYdRLSp-xwSGAjOLGSlKr19pEj6_g&oe=6A3427BF",
  "https://scontent.fixc1-12.fna.fbcdn.net/v/t39.35426-6/602970886_1938415330189657_7815958760597064900_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=106&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=gEpjfOikKjMQ7kNvwHEfcIg&_nc_oc=AdoKXnazkTlOiI56W8NnRIltvnqJQbP5PjxNNixLvjFFQpivU1K6ZlSl6vP-bV_tWSZ0MBQXyTruW-wMb-I4GLDt&_nc_zt=14&_nc_ht=scontent.fixc1-12.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af9P2rPzI916NES6BqPuy_s7ubJPJ0f9BC24W8qMSTYO-w&oe=6A3439C4",
  "https://scontent.fixc1-12.fna.fbcdn.net/v/t39.35426-6/597044924_865488039194217_2705850330967406790_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=111&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=rqXCFWqZNFwQ7kNvwF_kEBR&_nc_oc=AdoLDCXblfdOoNTEgKflmwDjZ5uRrcbME3zWF0Nj0LCV0ID_GJUKUD1VP4xhD6nmcUbh8tXTEENIf-i3cBov91iM&_nc_zt=14&_nc_ht=scontent.fixc1-12.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af_ig-kWGtOMIbzPnO46RVtAZjWElJ_UwjFB2Sm4CPrLBA&oe=6A344630",
  "https://scontent.fixc1-7.fna.fbcdn.net/v/t39.35426-6/604710216_25547288978294439_2293506194255551152_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=108&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=OcgS50f1q1YQ7kNvwFS_3U2&_nc_oc=AdpKNaAViIOT6N7XnUkHrtKzU0G6aew5Kd76Gpx3fEME8eSvxMF_GmtFZB5elk5FWbLEZb_P-kxq4c1YmszhciCy&_nc_zt=14&_nc_ht=scontent.fixc1-7.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af_65-AoasF_T4fM8gL8_aJrEV6-wNUNgsACgdpOILgkKA&oe=6A34236E",
  "https://scontent.fixc1-6.fna.fbcdn.net/v/t39.35426-6/603798284_2304743843324837_1028020946981686720_n.jpg?stp=dst-jpg_s600x600_tt6&_nc_cat=102&ccb=1-7&_nc_sid=c53f8f&_nc_ohc=me0WzRHA9CsQ7kNvwGjQL77&_nc_oc=Adr2ObNNrYLqh8OkCcKviz-0ns--62L3I1vSwTUKoGYgdz13TRkfwzUjvDetOLMgVPer8LZmdUqscJCDEbCyIez7&_nc_zt=14&_nc_ht=scontent.fixc1-6.fna&_nc_gid=gyz1txnkBz-7kHMaYtScOQ&_nc_ss=7b289&oh=00_Af9eyTTuysn8lhVrbcnPECM4cQNLSIXBvbqJdUU3_yD4qA&oe=6A343D3D"
];

async function run() {
  console.log("Starting seed download and upload script...");
  
  // 1. Seed Premium Library (25 items)
  console.log("Seeding Premium reference creatives...");
  for (let i = 0; i < premiumUrls.length; i++) {
    await processUrl(premiumUrls[i], 'premium', `seed_premium_${i + 1}`);
  }

  // 2. Seed EDM Library (25 items)
  console.log("Seeding EDM reference creatives...");
  for (let i = 0; i < edmUrls.length; i++) {
    await processUrl(edmUrls[i], 'edm', `seed_edm_${i + 1}`);
  }

  // 3. Seed High Converting Library (25 items)
  console.log("Seeding High Converting reference creatives...");
  for (let i = 0; i < highConvertingUrls.length; i++) {
    await processUrl(highConvertingUrls[i], 'high_converting', `seed_high_converting_${i + 1}`);
  }

  console.log("🎉 Seeding completed!");
}

async function processUrl(url, category, baseName) {
  try {
    const ext = url.includes('.png') ? 'png' : 'jpg';
    const key = `reference-creatives/${category}/${baseName}.${ext}`;
    
    // Download image
    console.log(`Downloading ${url} -> R2 Key ${key}...`);
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to download file from URL (status ${res.status})`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';

    // Upload to R2
    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimeType
    }));

    const publicUrl = `${R2_PUBLIC_URL}/adrolls-storage/${key}`;
    console.log(`✅ Uploaded to R2! Public URL: ${publicUrl}`);

    // Insert to DB
    const { data, error } = await supabaseAdmin
      .from('reference_creatives')
      .insert({
        category: category,
        url: publicUrl
      });

    if (error) {
      if (error.code === 'PGRST205' || error.message.includes('Could not find the table')) {
        console.warn(`⚠️ Supabase Insert failed because reference_creatives table does not exist yet.`);
        console.warn(`Please run the SQL migration script from supabase/migrations/20260614144500_create_reference_creatives.sql in your Supabase SQL Editor.`);
      } else {
        console.error(`❌ DB Insert failed:`, error.message);
      }
    } else {
      console.log(`✅ DB record created for ${baseName}`);
    }
  } catch (err) {
    console.error(`❌ Failed processing ${url}:`, err.message);
  }
}

run().catch(console.error);

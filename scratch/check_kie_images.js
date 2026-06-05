const KIE_API_KEY = process.env.KIE_API_KEY || "a19d2d3ecfb4efe4dfb54a67115db218";

const taskIds = [
    "907148f1c3f9d55d81df2dfa8eddf1c8",
    "936096fac5346015126f247dd81ea29d",
    "f2eb6d4db059d117d3b9be70f482d7aa",
    "dcb51ed2022845d2f2f6c68c829d9e0c",
    "b168b4380c572fac6443f68c8e72c31f"
];

async function checkTasks() {
    for (const tid of taskIds) {
        try {
            const res = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${tid}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${KIE_API_KEY}`
                }
            });
            if (res.ok) {
                const data = await res.json();
                console.log(`Task ${tid}:`, JSON.stringify(data, null, 2));
            } else {
                console.error(`Error HTTP ${res.status} for ${tid}`);
            }
        } catch (e) {
            console.error(`Network error for ${tid}:`, e.message);
        }
    }
}

checkTasks();
